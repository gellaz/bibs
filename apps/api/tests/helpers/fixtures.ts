import { eq, sql } from "drizzle-orm";
import { customerAddress } from "@/db/schemas/address";
import { user } from "@/db/schemas/auth";
import { brand } from "@/db/schemas/brand";
import { productCategory } from "@/db/schemas/category";
import { customerProfile } from "@/db/schemas/customer";
import type { DiscountStatus } from "@/db/schemas/discount";
import { discount, discountProduct } from "@/db/schemas/discount";
import { municipality, province, region } from "@/db/schemas/location";
import { organization } from "@/db/schemas/organization";
import {
	product,
	productCategoryAssignment,
	storeProduct,
} from "@/db/schemas/product";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { sellerProfile } from "@/db/schemas/seller";
import { store, storePhoneNumber } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { storeImage } from "@/db/schemas/store-image";
import {
	type StoreSubscriptionStatus,
	storeSubscription,
} from "@/db/schemas/store-subscription";
import type { DrizzleTestDb } from "./test-db";

// ── User / Auth ───────────────────────────────────────────────────────────────

export async function createTestCustomer(
	db: DrizzleTestDb,
	params: { name?: string; email?: string; points?: number } = {},
) {
	const userId = crypto.randomUUID();
	const [newUser] = await db
		.insert(user)
		.values({
			id: userId,
			name: params.name ?? "Test Customer",
			email: params.email ?? `customer-${userId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "customer",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.returning();

	const [profile] = await db
		.insert(customerProfile)
		.values({ userId, points: params.points ?? 0 })
		.returning();

	return { user: newUser, profile };
}

export async function createTestSeller(
	db: DrizzleTestDb,
	params: { name?: string; email?: string } = {},
) {
	const userId = crypto.randomUUID();
	const [newUser] = await db
		.insert(user)
		.values({
			id: userId,
			name: params.name ?? "Test Seller",
			email: params.email ?? `seller-${userId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "seller",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.returning();

	const [profile] = await db
		.insert(sellerProfile)
		.values({ userId, onboardingStatus: "active" })
		.returning();

	return { user: newUser, profile };
}

// ── Location ──────────────────────────────────────────────────────────────────

// Monotonic counter for municipality ISTAT codes. The columns are tiny
// (region varchar(2), province acronym varchar(2) / istat varchar(3),
// municipality varchar(6)) and unique, so random per-call codes collided across
// the suite. truncateAll() wipes the location tables between tests, so a shared
// region/province (find-or-create by a fixed name) only ever has one row alive
// at a time and its fixed codes can never collide; only the municipality varies
// per call, via this base36 counter (6 chars → ~2.1B values, no overflow).
let municipalitySeq = 0;

/** Creates a minimal region → province → municipality chain for tests. */
export async function createTestMunicipality(
	db: DrizzleTestDb,
	params: {
		regionName?: string;
		provinceName?: string;
		provinceAcronym?: string;
		municipalityName?: string;
	} = {},
) {
	// Shared region (find-or-create). Fixed ISTAT is safe: only one lives at a
	// time thanks to truncateAll between tests.
	const regionName = params.regionName ?? "Test Region";
	let testRegion = await db.query.region.findFirst({
		where: eq(region.name, regionName),
	});
	if (!testRegion) {
		[testRegion] = await db
			.insert(region)
			.values({ name: regionName, istatCode: "00" })
			.returning();
	}

	// Shared province (find-or-create).
	const provinceName = params.provinceName ?? "Test Province";
	const acronym = (params.provinceAcronym ?? "TT").toUpperCase();
	let testProvince = await db.query.province.findFirst({
		where: eq(province.name, provinceName),
	});
	if (!testProvince) {
		[testProvince] = await db
			.insert(province)
			.values({
				name: provinceName,
				acronym,
				istatCode: "000",
				regionId: testRegion.id,
			})
			.returning();
	}

	// Municipality: unique per call via a monotonic base36 ISTAT code.
	municipalitySeq += 1;
	const istatCode = municipalitySeq.toString(36).padStart(6, "0").slice(-6);
	const municipalityName = params.municipalityName ?? `Test City ${istatCode}`;
	const [testMunicipality] = await db
		.insert(municipality)
		.values({
			name: municipalityName,
			istatCode,
			provinceId: testProvince.id,
		})
		.returning();

	return testMunicipality;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export async function createTestStore(
	db: DrizzleTestDb,
	sellerProfileId: string,
	params: {
		name?: string;
		municipalityId?: string;
		/** longitude (x) */
		lng?: number;
		/** latitude (y) */
		lat?: number;
		/** null = leave location unset (for NULLS-LAST ordering tests) */
		noLocation?: boolean;
		categoryId?: string;
		openingHours?: Array<{
			dayOfWeek: number;
			slots: Array<{ open: string; close: string }>;
		}>;
		closures?: Array<{ startDate: string; endDate?: string; note?: string }>;
	} = {},
) {
	const lng = params.lng ?? 12.4964; // Rome
	const lat = params.lat ?? 41.9028;

	const municipalityId =
		params.municipalityId ?? (await createTestMunicipality(db)).id;

	const [newStore] = await db
		.insert(store)
		.values({
			sellerProfileId,
			name: params.name ?? "Test Store",
			addressLine1: "Via Roma 1",
			municipalityId,
			zipCode: "00100",
			country: "IT",
			categoryId: params.categoryId,
			openingHours: params.openingHours,
			closures: params.closures,
			// Raw SQL needed for PostGIS geometry column
			location: params.noLocation
				? null
				: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`,
		} as any)
		.returning();

	return newStore;
}

// ── Product ───────────────────────────────────────────────────────────────────

export async function createTestProduct(
	db: DrizzleTestDb,
	sellerProfileId: string,
	params: {
		name?: string;
		price?: string;
		description?: string;
		status?: "active" | "disabled" | "trashed";
		brandId?: string;
		categoryIds?: string[];
	} = {},
) {
	const [newProduct] = await db
		.insert(product)
		.values({
			sellerProfileId,
			name: params.name ?? "Test Product",
			description: params.description ?? "A test product",
			price: params.price ?? "10.00",
			status: params.status ?? "active",
			brandId: params.brandId,
		})
		.returning();

	if (params.categoryIds?.length) {
		await db.insert(productCategoryAssignment).values(
			params.categoryIds.map((cid) => ({
				productId: newProduct.id,
				productCategoryId: cid,
			})),
		);
	}

	return newProduct;
}

export async function createTestStoreProduct(
	db: DrizzleTestDb,
	storeId: string,
	productId: string,
	params: { stock?: number } = {},
) {
	const [sp] = await db
		.insert(storeProduct)
		.values({ storeId, productId, stock: params.stock ?? 10 })
		.returning();

	return sp;
}

export async function createTestMacroCategory(
	db: DrizzleTestDb,
	name = "Test Macro",
) {
	const existing = await db.query.productMacroCategory.findFirst({
		where: eq(productMacroCategory.name, name),
	});
	if (existing) return existing;

	const [macro] = await db
		.insert(productMacroCategory)
		.values({ name })
		.returning();

	return macro;
}

export async function createTestCategory(
	db: DrizzleTestDb,
	name = "Test Category",
	macroCategoryId?: string,
) {
	const macroId = macroCategoryId ?? (await createTestMacroCategory(db)).id;

	const [category] = await db
		.insert(productCategory)
		.values({ name, macroCategoryId: macroId })
		.returning();

	return category;
}

export async function createTestProductCategoryAssignment(
	db: DrizzleTestDb,
	productId: string,
	productCategoryId: string,
) {
	await db
		.insert(productCategoryAssignment)
		.values({ productId, productCategoryId });
}

export async function createTestBrand(
	db: DrizzleTestDb,
	sellerProfileId: string,
	name = "Test Brand",
) {
	const [b] = await db
		.insert(brand)
		.values({ sellerProfileId, name })
		.returning();
	return b;
}

// ── Organization ──────────────────────────────────────────────────────────────

export async function createTestOrganization(
	db: DrizzleTestDb,
	sellerProfileId: string,
	params: {
		businessName?: string;
		vatNumber?: string;
		legalForm?: string;
		vatStatus?: "pending" | "verified" | "rejected";
		municipalityId?: string;
	} = {},
) {
	const unique = crypto.randomUUID().slice(0, 8);
	const municipalityId =
		params.municipalityId ?? (await createTestMunicipality(db)).id;
	const [org] = await db
		.insert(organization)
		.values({
			sellerProfileId,
			businessName: params.businessName ?? `Test Org ${unique}`,
			// Derive 11 decimal digits from the full 32-bit hex value. The old
			// `unique.replace(/\D/g, "")` kept only the digit chars of an 8-char hex
			// slice (often 0-4 of them) then zero-padded, so many distinct UUIDs
			// collapsed onto the same vat (e.g. IT06820000000) → flaky unique-violation.
			vatNumber:
				params.vatNumber ??
				`IT${BigInt(`0x${unique}`).toString().padStart(11, "0").slice(-11)}`,
			legalForm: params.legalForm ?? "SRL",
			addressLine1: "Via Roma 1",
			municipalityId,
			zipCode: "00100",
			vatStatus: params.vatStatus ?? "pending",
		})
		.returning();

	return org;
}

// ── Customer address ──────────────────────────────────────────────────────────

export async function createTestCustomerAddress(
	db: DrizzleTestDb,
	customerProfileId: string,
	params: {
		label?: string;
		addressLine1?: string;
		municipalityId?: string;
		zipCode?: string;
		isDefault?: boolean;
	} = {},
) {
	const municipalityId =
		params.municipalityId ?? (await createTestMunicipality(db)).id;
	const [addr] = await db
		.insert(customerAddress)
		.values({
			customerProfileId,
			label: params.label ?? "Casa",
			addressLine1: params.addressLine1 ?? "Via Roma 1",
			municipalityId,
			zipCode: params.zipCode ?? "00100",
			country: "IT",
			isDefault: params.isDefault ?? false,
		})
		.returning();

	return addr;
}

// ── Discount ──────────────────────────────────────────────────────────────────

export async function createTestDiscount(
	db: DrizzleTestDb,
	sellerProfileId: string,
	params: {
		title?: string;
		percent?: number;
		startsAt?: Date;
		endsAt?: Date | null;
		status?: DiscountStatus;
	} = {},
) {
	const [row] = await db
		.insert(discount)
		.values({
			sellerProfileId,
			title: params.title ?? "Saldi di prova",
			percent: params.percent ?? 20,
			startsAt: params.startsAt ?? new Date(Date.now() - 60_000),
			endsAt:
				params.endsAt === undefined
					? new Date(Date.now() + 86_400_000)
					: params.endsAt,
			status: params.status ?? "active",
		})
		.returning();
	return row;
}

export async function createTestDiscountProduct(
	db: DrizzleTestDb,
	discountId: string,
	productId: string,
) {
	const [row] = await db
		.insert(discountProduct)
		.values({ discountId, productId })
		.returning();
	return row;
}

// ── Store subscription / category / image ───────────────────────────────────

export async function createTestStoreSubscription(
	db: DrizzleTestDb,
	storeId: string,
	params: { status?: StoreSubscriptionStatus } = {},
) {
	const unique = crypto.randomUUID().slice(0, 8);
	const [sub] = await db
		.insert(storeSubscription)
		.values({
			storeId,
			stripeSubscriptionId: `sub_${unique}`,
			stripeCustomerId: `cus_${unique}`,
			stripePriceId: `price_${unique}`,
			feeAmountCents: 1000,
			status: params.status ?? "active",
			currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
		})
		.returning();
	return sub;
}

export async function createTestStoreCategory(
	db: DrizzleTestDb,
	name = "Test Store Category",
) {
	const [c] = await db.insert(storeCategory).values({ name }).returning();
	return c;
}

export async function createTestStoreImage(
	db: DrizzleTestDb,
	storeId: string,
	params: { url?: string; position?: number } = {},
) {
	const unique = crypto.randomUUID().slice(0, 8);
	const [img] = await db
		.insert(storeImage)
		.values({
			storeId,
			url: params.url ?? `https://img.test/${unique}.jpg`,
			key: `stores/${unique}.jpg`,
			position: params.position ?? 0,
		})
		.returning();
	return img;
}

export async function createTestStorePhoneNumber(
	db: DrizzleTestDb,
	storeId: string,
	params: { label?: string | null; number?: string; position?: number } = {},
) {
	const [phone] = await db
		.insert(storePhoneNumber)
		.values({
			storeId,
			label: params.label ?? null,
			number: params.number ?? "0123456789",
			position: params.position ?? 0,
		})
		.returning();
	return phone;
}

/** Create a municipality with a specific name (region/province auto-created). */
export async function createTestMunicipalityNamed(
	db: DrizzleTestDb,
	name: string,
) {
	return createTestMunicipality(db, { municipalityName: name });
}
