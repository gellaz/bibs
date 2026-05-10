import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { productCategory } from "@/db/schemas/category";
import {
	product,
	productCategoryAssignment,
	storeProduct,
} from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import type { BrandsBySellerProfileId } from "./brands";
import { businessPrefixes } from "./sellers";
import {
	genEan13,
	pick,
	prefixToMacro,
	productAdjectives,
	productDescriptions,
	productNouns,
} from "./utils";

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
	const activeEmails = Array.from(
		{ length: 55 },
		(_, i) => `seller${i + 1}@test.com`,
	);

	const sellerRows = await db
		.select({
			email: user.email,
			sellerProfileId: sellerProfile.id,
		})
		.from(sellerProfile)
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		.where(
			and(
				inArray(user.email, activeEmails),
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

	// ── Load macro + sub categories grouped by macro name ─
	const subRows = await db
		.select({
			subId: productCategory.id,
			macroId: productCategory.macroCategoryId,
			subName: productCategory.name,
			macroName: productMacroCategory.name,
		})
		.from(productCategory)
		.innerJoin(
			productMacroCategory,
			eq(productMacroCategory.id, productCategory.macroCategoryId),
		);

	const subsByMacro = new Map<string, Array<{ id: string; name: string }>>();
	for (const r of subRows) {
		const arr = subsByMacro.get(r.macroName) ?? [];
		arr.push({ id: r.subId, name: r.subName });
		subsByMacro.set(r.macroName, arr);
	}

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

		const prefix = pick(businessPrefixes, idx, 1);
		const macro = prefixToMacro[prefix];
		if (!macro) {
			throw new Error(
				`seedProducts: no macro mapped for businessPrefix '${prefix}' (seller idx ${idx})`,
			);
		}
		const nouns = productNouns[macro];
		if (!nouns || nouns.length === 0) {
			throw new Error(`seedProducts: no productNouns for macro '${macro}'`);
		}

		const range = priceRangeByMacro[macro] ?? DEFAULT_PRICE_RANGE;
		const productCount = 30 + (rank % 21); // 30..50
		const sellerBrands = brandsBySeller.get(s.sellerProfileId) ?? [];

		for (let i = 0; i < productCount; i++) {
			const adj = pick(productAdjectives, i, 3, 2);
			const noun = pick(nouns, i, 1);
			const name = `${noun} ${adj}`;
			const description = `${pick(productDescriptions, i, 1, 5)} ${pick(productDescriptions, i, 7, 2)}`;
			const ean = genEan13(globalIdx);
			const priceNum = range.min + (i % (range.spread + 1));

			const brandId =
				sellerBrands.length > 0 && i % 10 !== 9
					? sellerBrands[i % sellerBrands.length].id
					: null;

			const status: "active" | "disabled" | "trashed" = (() => {
				const m100 = globalIdx % 100;
				if (m100 < 5) return "trashed";
				if (m100 < 10) return "disabled";
				return "active";
			})();

			productRows.push({
				sellerProfileId: s.sellerProfileId,
				name,
				description,
				ean,
				brandId,
				price: priceNum.toFixed(2),
				status,
				_macro: macro,
				_sellerRank: rank,
				_idxInSeller: i,
			});

			globalIdx++;
		}
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

	// ── productCategoryAssignment ─────────────────────────
	const categoryAssignmentRows: Array<{
		productId: string;
		productCategoryId: string;
	}> = [];

	for (const p of productMeta) {
		const subs = subsByMacro.get(p.macro);
		if (!subs || subs.length === 0) continue;
		const sub = subs[p.idxInSeller % subs.length];
		categoryAssignmentRows.push({
			productId: p.id,
			productCategoryId: sub.id,
		});
	}

	for (const chunk of chunked(categoryAssignmentRows)) {
		await db.insert(productCategoryAssignment).values(chunk);
	}

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

		targetStores.forEach((storeId, storeIdx) => {
			const stock = 5 + ((p.idxInSeller + storeIdx) % 50);
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
		`  ✓ ${insertedProducts.length} products, ${categoryAssignmentRows.length} category assignments, ${storeProductRows.length} store inventory rows, ${imageRows.length} images`,
	);
}
