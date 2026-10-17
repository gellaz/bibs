import { and, asc, count, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { productCategory } from "@/db/schemas/category";
import { product, storeProduct } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import type { BrandsBySellerProfileId } from "./brands";
import { ALCOHOLIC_SUBS, catalogByPrefix, descriptionsFor } from "./catalog";
import { genEan13, pick, prefixForSeller } from "./utils";

// ── Price ranges per macro (in €, integer; numeric stored with .toFixed(2)) ─

const priceRangeByMacro: Record<string, { min: number; spread: number }> = {
	"Alimentari e bevande": { min: 2, spread: 28 },
	Abbigliamento: { min: 25, spread: 175 },
	"Casa e cucina": { min: 15, spread: 85 },
	"Fai da te e industria": { min: 10, spread: 90 },
	"Bellezza e cura personale": { min: 8, spread: 60 },
	"Libri e media": { min: 8, spread: 32 },
	"Ufficio e scuola": { min: 3, spread: 27 },
	"Giardino e outdoor": { min: 5, spread: 65 },
	"Sport e tempo libero": { min: 12, spread: 130 },
	Infanzia: { min: 6, spread: 54 },
	Elettronica: { min: 9, spread: 190 },
	"Animali domestici": { min: 4, spread: 46 },
	"Hobby e creatività": { min: 3, spread: 32 },
	"Auto e moto": { min: 7, spread: 110 },
};

const DEFAULT_PRICE_RANGE = { min: 10, spread: 90 };

const CHUNK = 500;

function chunked<T>(arr: T[], size = CHUNK): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		out.push(arr.slice(i, i + size));
	}
	return out;
}

export async function seedProducts(brandsBySeller: BrandsBySellerProfileId) {
	// ── Resolve active sellers ────────────────────────────
	// Filtro sul pattern, non su una lista di lunghezza fissa: così i blocchi
	// aggiunti a `statusDistribution` entrano da soli. `seller@dev.bibs` resta
	// fuori — non finisce in `seller%@test.com` — e ha un catalogo scritto a mano (dev-seller-catalog.ts).
	const sellerRows = await db
		.select({
			email: user.email,
			sellerProfileId: sellerProfile.id,
		})
		.from(sellerProfile)
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		.where(
			and(
				like(user.email, "seller%@test.com"),
				eq(sellerProfile.onboardingStatus, "active"),
			),
		)
		.orderBy(asc(user.email));

	if (sellerRows.length === 0) {
		console.log("  ⏭ No active sellers found, skipping products");
		return;
	}

	// ── Canary: first active seller already has products? ─
	const firstSellerProfileId = sellerRows[0].sellerProfileId;
	const [{ value: existingCount }] = await db
		.select({ value: count() })
		.from(product)
		.where(eq(product.sellerProfileId, firstSellerProfileId));
	if (existingCount > 0) {
		console.log("  ⏭ Products already seeded, skipping");
		return;
	}

	// ── Precondition: macro categories must exist ─────────
	const [{ value: macroCount }] = await db
		.select({ value: count() })
		.from(productMacroCategory);
	if (macroCount === 0) {
		throw new Error(
			"seedProducts: no product_macro_categories found — run seedBase first",
		);
	}

	// ── Sub-categories by (macro, sub): names repeat across macros ─
	const subRows = await db
		.select({
			id: productCategory.id,
			sub: productCategory.name,
			macro: productMacroCategory.name,
			vatRate: productMacroCategory.suggestedVatRate,
		})
		.from(productCategory)
		.innerJoin(
			productMacroCategory,
			eq(productMacroCategory.id, productCategory.macroCategoryId),
		)
		.orderBy(asc(productMacroCategory.name), asc(productCategory.name));
	const subByPair = new Map(subRows.map((r) => [`${r.macro}|${r.sub}`, r]));

	// ── Load all stores per seller ────────────────────────
	const sellerProfileIds = sellerRows.map((s) => s.sellerProfileId);
	const storeRows = await db
		.select({
			id: store.id,
			sellerProfileId: store.sellerProfileId,
		})
		.from(store)
		.where(inArray(store.sellerProfileId, sellerProfileIds))
		.orderBy(asc(store.createdAt), asc(store.id));

	const storesBySeller = new Map<string, string[]>();
	for (const s of storeRows) {
		const arr = storesBySeller.get(s.sellerProfileId) ?? [];
		arr.push(s.id);
		storesBySeller.set(s.sellerProfileId, arr);
	}

	// ── Build product rows ────────────────────────────────
	type ProductRow = typeof product.$inferInsert & {
		_macro: string; // private metadata, stripped before insert
		_sellerRank: number;
		_idxInSeller: number;
	};

	const productRows: ProductRow[] = [];
	let globalIdx = 0;

	sellerRows.forEach((s, rank) => {
		// Recover the original idx in seedSellers from the email.
		const m = s.email.match(/^seller(\d+)@test\.com$/);
		if (!m) return;
		const idx = Number.parseInt(m[1], 10) - 1;

		const prefix = prefixForSeller(idx);
		const entries = catalogByPrefix[prefix];
		if (!entries) {
			throw new Error(
				`seedProducts: no catalog for businessPrefix '${prefix}' (seller idx ${idx})`,
			);
		}
		const sellerBrands = brandsBySeller.get(s.sellerProfileId) ?? [];

		entries.forEach((entry, i) => {
			const sub = subByPair.get(`${entry.macro}|${entry.sub}`);
			if (!sub) {
				throw new Error(
					`seedProducts: sub-category '${entry.macro} / ${entry.sub}' not found — run seedBase first`,
				);
			}
			const range = entry.price
				? { min: entry.price[0], spread: entry.price[1] - entry.price[0] }
				: (priceRangeByMacro[entry.macro] ?? DEFAULT_PRICE_RANGE);
			const ean = genEan13(globalIdx);
			const priceNum = range.min + (i % (range.spread + 1));

			// Solo marchi della stessa macro: niente vino con un marchio di elettronica.
			const brands = sellerBrands.filter((b) => b.macro === entry.macro);
			const brandId =
				brands.length > 0 && i % 10 !== 9 ? brands[i % brands.length].id : null;

			const status: "active" | "disabled" | "trashed" = (() => {
				const m100 = globalIdx % 100;
				if (m100 < 5) return "trashed";
				if (m100 < 10) return "disabled";
				return "active";
			})();

			productRows.push({
				sellerProfileId: s.sellerProfileId,
				name: entry.name,
				description: pick(descriptionsFor(entry), i),
				ean,
				brandId,
				price: priceNum.toFixed(2),
				// Default del form seller per macro, ma gli alcolici restano al 22%.
				vatRate: ALCOHOLIC_SUBS.has(entry.sub) ? "22" : sub.vatRate,
				status,
				productCategoryId: sub.id,
				_macro: entry.macro,
				_sellerRank: rank,
				_idxInSeller: i,
			});

			globalIdx++;
		});
	});

	console.log(
		`  📦 Seeding ${productRows.length} products across ${sellerRows.length} sellers...`,
	);

	// ── Insert products in chunks ─────────────────────────
	const insertedProducts: Array<{
		id: string;
		sellerProfileId: string;
		status: string;
	}> = [];

	const stripPrivate = (r: ProductRow): typeof product.$inferInsert => {
		const { _macro, _sellerRank, _idxInSeller, ...rest } = r;
		return rest;
	};

	for (const chunk of chunked(productRows)) {
		const inserted = await db
			.insert(product)
			.values(chunk.map(stripPrivate))
			.returning({
				id: product.id,
				sellerProfileId: product.sellerProfileId,
				status: product.status,
			});
		insertedProducts.push(...inserted);
	}

	// Map back: insertedProducts is in the same order as productRows since we
	// inserted in the same order chunk by chunk.
	const productMeta = insertedProducts.map((ip, i) => {
		const row = productRows[i];
		return {
			id: ip.id,
			sellerProfileId: ip.sellerProfileId,
			status: ip.status as "active" | "disabled" | "trashed",
			macro: row._macro,
			sellerRank: row._sellerRank,
			idxInSeller: row._idxInSeller,
		};
	});

	// ── storeProduct (inventory) ──────────────────────────
	const storeProductRows: Array<{
		productId: string;
		storeId: string;
		stock: number;
	}> = [];

	for (const p of productMeta) {
		const stores = storesBySeller.get(p.sellerProfileId) ?? [];
		if (stores.length === 0) continue;

		// 70% in all stores, 30% in a single store
		const inAll = p.idxInSeller % 10 < 7;
		const targetStores = inAll
			? stores
			: [stores[p.idxInSeller % stores.length]];

		// Un prodotto su venti esaurito e uno sotto soglia: la home seller li
		// segnala. Gli ordini pescano stock > 5, quindi non li toccano.
		const slot = p.idxInSeller % 20;
		targetStores.forEach((storeId, storeIdx) => {
			let stock = 5 + ((p.idxInSeller + storeIdx) % 50);
			if (slot === 0) stock = 0;
			if (slot === 1) stock = 2;
			storeProductRows.push({ productId: p.id, storeId, stock });
		});
	}

	for (const chunk of chunked(storeProductRows)) {
		await db.insert(storeProduct).values(chunk);
	}

	// ── productImage (placeholder, only for active products) ─
	const imageRows: Array<{
		productId: string;
		url: string;
		key: string;
		position: number;
	}> = [];

	for (const p of productMeta) {
		if (p.status !== "active") continue;
		imageRows.push({
			productId: p.id,
			url: `https://picsum.photos/seed/${p.id}/600/600`,
			key: `picsum-${p.id}-0`,
			position: 0,
		});
		if (p.idxInSeller % 10 < 3) {
			imageRows.push({
				productId: p.id,
				url: `https://picsum.photos/seed/${p.id}-2/600/600`,
				key: `picsum-${p.id}-1`,
				position: 1,
			});
		}
	}

	for (const chunk of chunked(imageRows)) {
		await db.insert(productImage).values(chunk);
	}

	console.log(
		`  ✓ ${insertedProducts.length} products, ${storeProductRows.length} store inventory rows, ${imageRows.length} images`,
	);
}
