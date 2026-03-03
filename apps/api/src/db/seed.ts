import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { municipality, province, region } from "@/db/schemas/location";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { auth } from "@/lib/auth";

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

const SEED_DATA_DIR = `${import.meta.dirname}/seed-data`;

const testUsers = [
	{
		name: "Admin User",
		email: "admin@test.com",
		password: "password123",
		role: "admin",
	},
	{
		name: "Customer User",
		email: "customer@test.com",
		password: "password123",
		role: "customer",
	},
	{
		name: "Seller User",
		email: "seller@test.com",
		password: "password123",
		role: "seller",
		vatStatus: "verified",
		vatNumber: "IT12345678901",
	},
	{
		name: "Seller Pending",
		email: "seller-pending@test.com",
		password: "password123",
		role: "seller",
		vatStatus: "pending",
		vatNumber: "IT12345678902",
	},
	{
		name: "Seller Rejected",
		email: "seller-rejected@test.com",
		password: "password123",
		role: "seller",
		vatStatus: "rejected",
		vatNumber: "IT12345678903",
	},
] as const;

export async function seed() {
	console.log("🌱 Seeding database...");

	for (const testUser of testUsers) {
		const existing = await db.query.user.findFirst({
			where: eq(user.email, testUser.email),
		});

		if (existing) {
			console.log(`  ⏭ ${testUser.email} already exists, skipping`);
			continue;
		}

		const { user: created } = await auth.api.signUpEmail({
			body: {
				name: testUser.name,
				email: testUser.email,
				password: testUser.password,
			},
		});

		await db
			.update(user)
			.set({ role: testUser.role })
			.where(eq(user.id, created.id));

		if (testUser.role === "customer") {
			await db.insert(customerProfile).values({ userId: created.id });
		}

		if (testUser.role === "seller") {
			const vatStatus =
				"vatStatus" in testUser ? testUser.vatStatus : "pending";
			const vatNumber =
				"vatNumber" in testUser ? testUser.vatNumber : "IT00000000000";
			const [sp] = await db
				.insert(sellerProfile)
				.values({
					userId: created.id,
					vatNumber,
					vatStatus,
				})
				.returning();

			if (vatStatus === "verified") {
				await db.insert(store).values({
					sellerProfileId: sp.id,
					name: "Test Store",
					description: "A test store for development",
					addressLine1: "Via Roma 1",
					city: "Milano",
					zipCode: "20121",
					province: "MI",
				});
			}
		}

		console.log(`  ✓ ${testUser.email} (${testUser.role})`);
	}

	await seedLocations();

	console.log("🌱 Seed complete");
}

async function seedLocations() {
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

	// Insert municipalities in chunks of 1000
	const CHUNK_SIZE = 1000;
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
