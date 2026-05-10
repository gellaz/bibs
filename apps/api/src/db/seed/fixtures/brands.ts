import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { brand } from "@/db/schemas/brand";
import { sellerProfile } from "@/db/schemas/seller";
import { brandPool } from "./utils";

/** Seller active rank → list of brand rows assigned to that seller. */
export type BrandsBySellerProfileId = Map<
	string,
	Array<{ id: string; name: string }>
>;

/**
 * Picks a deterministic, distinct subset of brands for a given seller rank.
 * Loops with bumped offsets until the Set contains `count` distinct names.
 */
function pickBrandsForSeller(rank: number, count: number): readonly string[] {
	const out = new Set<string>();
	let offset = 0;
	while (out.size < count && offset < brandPool.length * 2) {
		const idx = (rank * 3 + offset) % brandPool.length;
		out.add(brandPool[idx]);
		offset++;
	}
	return Array.from(out);
}

export async function seedBrands(): Promise<BrandsBySellerProfileId> {
	const map: BrandsBySellerProfileId = new Map();

	// ── Resolve active sellers (idx 0..54 → seller1..seller55) ─
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
		console.log("  ⏭ No active sellers found, skipping brands");
		return map;
	}

	// ── Canary: first active seller already has 'Barilla'? ──
	const firstSellerProfileId = sellerRows[0].sellerProfileId;
	const canary = await db.query.brand.findFirst({
		where: and(
			eq(brand.sellerProfileId, firstSellerProfileId),
			eq(brand.name, "Barilla"),
		),
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
		for (const b of existing) {
			const arr = map.get(b.sellerProfileId) ?? [];
			arr.push({ id: b.id, name: b.name });
			map.set(b.sellerProfileId, arr);
		}
		return map;
	}

	// ── Build brand rows ──────────────────────────────────
	const rowsToInsert: Array<{ sellerProfileId: string; name: string }> = [];

	sellerRows.forEach((s, rank) => {
		const count = 4 + (rank % 5); // 4..8
		const names = pickBrandsForSeller(rank, count);
		for (const name of names) {
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

	for (const b of inserted) {
		const arr = map.get(b.sellerProfileId) ?? [];
		arr.push({ id: b.id, name: b.name });
		map.set(b.sellerProfileId, arr);
	}

	console.log(`  ✓ ${inserted.length} brands seeded`);
	return map;
}
