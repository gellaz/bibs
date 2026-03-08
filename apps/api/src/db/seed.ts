import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { productCategory } from "@/db/schemas/category";
import { customerProfile } from "@/db/schemas/customer";
import { municipality, province, region } from "@/db/schemas/location";
import { organization } from "@/db/schemas/organization";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
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
		email: "admin@test.com",
		password: "password123",
		role: "admin",
	},
	{
		email: "customer@test.com",
		password: "password123",
		role: "customer",
	},
	{
		email: "seller@test.com",
		password: "password123",
		role: "seller",
		onboardingStatus: "active" as const,
		vatNumber: "12345678901",
		vatStatus: "verified" as const,
	},
	{
		email: "seller-pending@test.com",
		password: "password123",
		role: "seller",
		onboardingStatus: "pending_review" as const,
		vatNumber: "12345678902",
		vatStatus: "pending" as const,
	},
	{
		email: "seller-rejected@test.com",
		password: "password123",
		role: "seller",
		onboardingStatus: "rejected" as const,
		vatNumber: "12345678903",
		vatStatus: "rejected" as const,
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

		const name = testUser.email.split("@")[0];
		const { user: created } = await auth.api.signUpEmail({
			body: {
				name,
				email: testUser.email,
				password: testUser.password,
			},
		});

		await db
			.update(user)
			.set({ role: testUser.role, emailVerified: true })
			.where(eq(user.id, created.id));

		if (testUser.role === "customer") {
			await db.insert(customerProfile).values({ userId: created.id });
		}

		if (testUser.role === "seller") {
			const onboardingStatus =
				"onboardingStatus" in testUser
					? testUser.onboardingStatus
					: ("pending_email" as const);
			const vatNumber =
				"vatNumber" in testUser ? testUser.vatNumber : "00000000000";
			const vatStatus =
				"vatStatus" in testUser ? testUser.vatStatus : ("pending" as const);

			const [sp] = await db
				.insert(sellerProfile)
				.values({
					userId: created.id,
					onboardingStatus,
				})
				.returning();

			await db.insert(organization).values({
				sellerProfileId: sp.id,
				businessName: `${name} SRL`,
				vatNumber,
				legalForm: "SRL",
				addressLine1: "Via Roma 1",
				city: "Milano",
				zipCode: "20121",
				province: "MI",
				vatStatus,
			});

			if (onboardingStatus === "active") {
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
	await seedStoreCategories();
	await seedProductCategories();

	console.log("🌱 Seed complete");
}

const defaultStoreCategories = [
	"Alimentari",
	"Abbigliamento",
	"Elettronica",
	"Casa e arredamento",
	"Sport e tempo libero",
	"Salute e bellezza",
	"Libreria e cartoleria",
	"Gioielleria e accessori",
	"Ristorazione",
	"Servizi",
	"Altro",
];

async function seedStoreCategories() {
	const [{ total }] = await db.select({ total: count() }).from(storeCategory);
	if (total > 0) {
		console.log("  ⏭ Store categories already seeded, skipping");
		return;
	}

	console.log("  🏷️ Seeding store categories...");
	await db
		.insert(storeCategory)
		.values(defaultStoreCategories.map((name) => ({ name })));
	console.log(`     ✓ ${defaultStoreCategories.length} store categories`);
}

const defaultProductCategories = [
	"Frutta e verdura",
	"Pane e prodotti da forno",
	"Pasta e riso",
	"Carne e salumi",
	"Pesce e frutti di mare",
	"Latticini e formaggi",
	"Uova",
	"Olio e condimenti",
	"Conserve e sottoli",
	"Farine e cereali",
	"Legumi",
	"Spezie e aromi",
	"Dolci e pasticceria",
	"Cioccolato e confetti",
	"Gelati e sorbetti",
	"Bevande analcoliche",
	"Vino",
	"Birra artigianale",
	"Liquori e distillati",
	"Caffè e tè",
	"Miele e confetture",
	"Snack e frutta secca",
	"Prodotti biologici",
	"Prodotti senza glutine",
	"Prodotti vegani",
	"Cosmetici naturali",
	"Saponi e detergenti",
	"Candele e profumi",
	"Ceramiche e terracotta",
	"Tessuti e stoffe",
	"Abbigliamento artigianale",
	"Borse e pelletteria",
	"Gioielli artigianali",
	"Bigiotteria",
	"Oggettistica e souvenir",
	"Giocattoli in legno",
	"Articoli per la casa",
	"Piante e fiori",
	"Sementi e giardinaggio",
	"Prodotti per animali",
	"Libri e riviste",
	"Cartoleria e cancelleria",
	"Articoli per feste",
	"Fotografia e stampe",
	"Musica e vinili",
	"Antiquariato e vintage",
	"Elettronica e accessori",
	"Attrezzatura sportiva",
	"Articoli per bambini",
	"Prodotti per la salute",
];

async function seedProductCategories() {
	const [{ total }] = await db.select({ total: count() }).from(productCategory);
	if (total > 0) {
		console.log("  ⏭ Product categories already seeded, skipping");
		return;
	}

	console.log("  🏷️ Seeding product categories...");
	await db
		.insert(productCategory)
		.values(defaultProductCategories.map((name) => ({ name })));
	console.log(`     ✓ ${defaultProductCategories.length} product categories`);
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
