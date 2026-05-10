import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { businessPrefixes } from "./sellers";
import { cities, lastNames, pick, streets } from "./utils";

// ── Multi-store seller designation ────────────────────────

/** Indices (0-based) of the 8 active sellers that get extra stores. */
const MULTI_STORE_IDXS = [0, 7, 14, 21, 28, 35, 42, 49] as const;

const SUFFIXES = [
	"Centro",
	"Stazione",
	"Duomo",
	"Porto",
	"Borgo",
	"Quartiere Nuovo",
] as const;

/** 4 designati con 3 store totali (2 extra), 4 con 2 store totali (1 extra). */
function extraCountFor(rankInDesignated: number): number {
	return rankInDesignated % 2 === 0 ? 2 : 1;
}

/** Extra-store data, derived from the original idx of the seller in seedSellers. */
function buildExtraStoresFor(
	rankInDesignated: number,
	idx: number,
): Array<{
	name: string;
	addressLine1: string;
	city: string;
	zipCode: string;
	province: string;
	lat: number;
	lng: number;
}> {
	const lastName = pick(lastNames, idx, 3, 7);
	const prefix = pick(businessPrefixes, idx, 1);
	// Half of the designated keep the same city as the first store (cluster);
	// the other half pick a nearby-ish city from the cities pool.
	const sameCity = rankInDesignated % 2 === 0;
	const baseStoreCity = pick(cities, idx, 5, 3);
	const altStoreCity = pick(cities, idx, 5, 7);
	const cityForExtras = sameCity ? baseStoreCity : altStoreCity;

	const count = extraCountFor(rankInDesignated);
	const out: ReturnType<typeof buildExtraStoresFor> = [];

	for (let extraIdx = 0; extraIdx < count; extraIdx++) {
		const suffix = pick(SUFFIXES, idx, 1, extraIdx);
		const street = pick(streets, idx, 13, 19 + extraIdx * 7);
		const streetNum = ((idx + extraIdx * 50) % 150) + 1;

		out.push({
			name: `${prefix} ${lastName} ${suffix}`,
			addressLine1: `${street}, ${streetNum}`,
			city: cityForExtras.name,
			zipCode: cityForExtras.zip,
			province: cityForExtras.province,
			lat: cityForExtras.lat + (idx % 10) * 0.001 + 0.005 * (extraIdx + 1),
			lng: cityForExtras.lng + (idx % 7) * 0.001 + 0.005 * (extraIdx + 1),
		});
	}

	return out;
}

export async function seedExtraStores() {
	// ── Resolve sellerProfileId for each designated seller ─
	const designatedEmails = MULTI_STORE_IDXS.map(
		(idx) => `seller${idx + 1}@test.com`,
	);

	const rows = await db
		.select({
			email: user.email,
			sellerProfileId: sellerProfile.id,
		})
		.from(sellerProfile)
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		.where(inArray(user.email, designatedEmails));

	if (rows.length === 0) {
		console.log("  ⏭ No designated sellers found, skipping extra stores");
		return;
	}

	const byEmail = new Map(rows.map((r) => [r.email, r.sellerProfileId]));
	const designatedSellerProfileIds = Array.from(byEmail.values());

	// ── Per-seller canary: which extra-store names already exist? ─
	// For each designated seller we expect specific store names (built
	// deterministically). We skip only the inserts for names that are
	// already present, so partial state from previous runs is healed.
	const existingNamed = await db
		.select({
			sellerProfileId: store.sellerProfileId,
			name: store.name,
		})
		.from(store)
		.where(inArray(store.sellerProfileId, designatedSellerProfileIds));

	const existingByPair = new Set(
		existingNamed.map((r) => `${r.sellerProfileId}::${r.name}`),
	);

	// ── Build extra store rows (skipping ones already present) ─
	const extraStoreRows: Array<typeof store.$inferInsert> = [];
	let alreadyPresent = 0;

	MULTI_STORE_IDXS.forEach((idx, rank) => {
		const email = `seller${idx + 1}@test.com`;
		const sellerProfileId = byEmail.get(email);
		if (!sellerProfileId) return;

		const extras = buildExtraStoresFor(rank, idx);
		for (const e of extras) {
			if (existingByPair.has(`${sellerProfileId}::${e.name}`)) {
				alreadyPresent++;
				continue;
			}
			extraStoreRows.push({
				sellerProfileId,
				name: e.name,
				description:
					"Punto vendita aggiuntivo dello stesso titolare, con la stessa cura e qualità.",
				addressLine1: e.addressLine1,
				city: e.city,
				zipCode: e.zipCode,
				province: e.province,
				location: { x: e.lng, y: e.lat },
			});
		}
	});

	if (extraStoreRows.length === 0) {
		console.log(
			`  ⏭ Extra stores already seeded (${alreadyPresent} present), skipping`,
		);
		return;
	}

	console.log(
		`  🏪 Seeding ${extraStoreRows.length} extra stores (${alreadyPresent} already present)...`,
	);
	await db.insert(store).values(extraStoreRows);
	console.log(`  ✓ ${extraStoreRows.length} extra stores seeded`);
}
