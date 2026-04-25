import { count } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province, region } from "@/db/schemas/location";

// ── Types for JSON seed files ───────────────

interface RegionData {
	name: string;
	istatCode: string;
}

interface ProvinceData {
	name: string;
	acronym: string;
	istatCode: string;
	regionIstatCode: string;
}

interface MunicipalityData {
	name: string;
	istatCode: string;
	provinceIstatCode: string;
}

// ── Seeding function ────────────────────────

const SEED_DATA_DIR = import.meta.dirname;
const CHUNK_SIZE = 1000;

export async function seedLocations() {
	const [{ total }] = await db.select({ total: count() }).from(region);
	if (total > 0) {
		console.log("  ⏭ Locations already seeded, skipping");
		return;
	}

	console.log("  📍 Seeding locations...");

	const regionsData: RegionData[] = await Bun.file(
		`${SEED_DATA_DIR}/regions.json`,
	).json();
	const provincesData: ProvinceData[] = await Bun.file(
		`${SEED_DATA_DIR}/provinces.json`,
	).json();
	const municipalitiesData: MunicipalityData[] = await Bun.file(
		`${SEED_DATA_DIR}/municipalities.json`,
	).json();

	// Insert regions and build istatCode -> id map
	const insertedRegions = await db
		.insert(region)
		.values(regionsData)
		.returning({ id: region.id, istatCode: region.istatCode });

	const regionMap = new Map(insertedRegions.map((r) => [r.istatCode, r.id]));
	console.log(`     ✓ ${insertedRegions.length} regions`);

	// Insert provinces with FK resolution
	const insertedProvinces = await db
		.insert(province)
		.values(
			provincesData.map((p) => ({
				name: p.name,
				acronym: p.acronym,
				istatCode: p.istatCode,
				regionId: regionMap.get(p.regionIstatCode)!,
			})),
		)
		.returning({ id: province.id, istatCode: province.istatCode });

	const provinceMap = new Map(
		insertedProvinces.map((p) => [p.istatCode, p.id]),
	);
	console.log(`     ✓ ${insertedProvinces.length} provinces`);

	// Insert municipalities in chunks
	let inserted = 0;
	for (let i = 0; i < municipalitiesData.length; i += CHUNK_SIZE) {
		const chunk = municipalitiesData.slice(i, i + CHUNK_SIZE);
		await db.insert(municipality).values(
			chunk.map((m) => ({
				name: m.name,
				istatCode: m.istatCode,
				provinceId: provinceMap.get(m.provinceIstatCode)!,
			})),
		);
		inserted += chunk.length;
	}
	console.log(`     ✓ ${inserted} municipalities`);
}
