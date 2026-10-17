import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { brand } from "@/db/schemas/brand";
import { sellerProfile } from "@/db/schemas/seller";
import { brandPoolByMacro, catalogByPrefix } from "./catalog";
import { prefixForSeller } from "./utils";

/** Seller active rank → list of brand rows assigned to that seller. */
export type BrandsBySellerProfileId = Map<
	string,
	Array<{ id: string; name: string; macro: string }>
>;

// I marchi sono unici tra le macro (test del catalogo): dal nome si risale alla macro.
const macroByBrand = new Map(
	Object.entries(brandPoolByMacro).flatMap(([macro, names]) =>
		names.map((name) => [name, macro] as const),
	),
);

/**
 * 4–8 marchi distinti per seller, a turno tra le macro che vende: così ogni
 * macro del suo catalogo ha almeno un marchio. Deterministico per rank.
 */
function pickBrandsForSeller(rank: number, macros: readonly string[]) {
	const count = 4 + (rank % 5); // 4..8
	return Array.from({ length: count }, (_, k) => {
		const pool = brandPoolByMacro[macros[k % macros.length]];
		return pool[(rank * 3 + Math.floor(k / macros.length)) % pool.length];
	});
}

export async function seedBrands(): Promise<BrandsBySellerProfileId> {
	const map: BrandsBySellerProfileId = new Map();

	// ── Resolve active sellers ────────────────────────────
	// Come in `seedProducts`: pattern invece di una lista a lunghezza fissa, così
	// i blocchi aggiunti a `statusDistribution` entrano senza toccare questo file.
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
		console.log("  ⏭ No active sellers found, skipping brands");
		return map;
	}

	// ── Canary: first active seller already has brands? ──
	const canary = await db.query.brand.findFirst({
		where: eq(brand.sellerProfileId, sellerRows[0].sellerProfileId),
	});
	if (canary) {
		console.log("  ⏭ Brands already seeded, fetching existing for products");
		const existing = await db
			.select({
				id: brand.id,
				name: brand.name,
				sellerProfileId: brand.sellerProfileId,
			})
			.from(brand)
			.where(
				inArray(
					brand.sellerProfileId,
					sellerRows.map((s) => s.sellerProfileId),
				),
			);
		addToMap(map, existing);
		return map;
	}

	// ── Build brand rows ──────────────────────────────────
	const rowsToInsert: Array<{ sellerProfileId: string; name: string }> = [];

	sellerRows.forEach((s, rank) => {
		// Come in `seedProducts`: l'idx originale del seller sta nell'email.
		const m = s.email.match(/^seller(\d+)@test\.com$/);
		if (!m) return;
		const prefix = prefixForSeller(Number.parseInt(m[1], 10) - 1);
		const macros = [...new Set(catalogByPrefix[prefix].map((e) => e.macro))];
		for (const name of pickBrandsForSeller(rank, macros)) {
			rowsToInsert.push({ sellerProfileId: s.sellerProfileId, name });
		}
	});

	console.log(
		`  🏷️ Seeding ${rowsToInsert.length} brands for ${sellerRows.length} sellers...`,
	);

	const inserted = await db.insert(brand).values(rowsToInsert).returning({
		id: brand.id,
		sellerProfileId: brand.sellerProfileId,
		name: brand.name,
	});

	addToMap(map, inserted);

	console.log(`  ✓ ${inserted.length} brands seeded`);
	return map;
}

function addToMap(
	map: BrandsBySellerProfileId,
	rows: Array<{ id: string; name: string; sellerProfileId: string }>,
) {
	for (const b of rows) {
		const arr = map.get(b.sellerProfileId) ?? [];
		arr.push({ id: b.id, name: b.name, macro: macroByBrand.get(b.name) ?? "" });
		map.set(b.sellerProfileId, arr);
	}
}
