import { eq, sql } from "drizzle-orm";
import { customerAddress } from "@/db/schemas/address";
import { user } from "@/db/schemas/auth";
import { productCategory } from "@/db/schemas/category";
import { customerProfile } from "@/db/schemas/customer";
import { organization } from "@/db/schemas/organization";
import {
	product,
	productClassification,
	storeProduct,
} from "@/db/schemas/product";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
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

// ── Store ─────────────────────────────────────────────────────────────────────

export async function createTestStore(
	db: DrizzleTestDb,
	sellerProfileId: string,
	params: {
		name?: string;
		/** longitude (x) */
		lng?: number;
		/** latitude (y) */
		lat?: number;
	} = {},
) {
	const lng = params.lng ?? 12.4964; // Rome
	const lat = params.lat ?? 41.9028;

	const [newStore] = await db
		.insert(store)
		.values({
			sellerProfileId,
			name: params.name ?? "Test Store",
			addressLine1: "Via Roma 1",
			city: "Roma",
			zipCode: "00100",
			country: "IT",
			// Raw SQL needed for PostGIS geometry column
			location: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`,
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
	} = {},
) {
	const [newProduct] = await db
		.insert(product)
		.values({
			sellerProfileId,
			name: params.name ?? "Test Product",
			description: params.description ?? "A test product",
			price: params.price ?? "10.00",
			isActive: true,
		})
		.returning();

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

export async function createTestProductClassification(
	db: DrizzleTestDb,
	productId: string,
	productCategoryId: string,
) {
	await db
		.insert(productClassification)
		.values({ productId, productCategoryId });
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
	} = {},
) {
	const unique = crypto.randomUUID().slice(0, 8);
	const [org] = await db
		.insert(organization)
		.values({
			sellerProfileId,
			businessName: params.businessName ?? `Test Org ${unique}`,
			vatNumber:
				params.vatNumber ??
				`IT${unique.replace(/\D/g, "").padEnd(11, "0").slice(0, 11)}`,
			legalForm: params.legalForm ?? "SRL",
			addressLine1: "Via Roma 1",
			city: "Roma",
			zipCode: "00100",
			province: "RM",
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
		city?: string;
		zipCode?: string;
		isDefault?: boolean;
	} = {},
) {
	const [addr] = await db
		.insert(customerAddress)
		.values({
			customerProfileId,
			label: params.label ?? "Casa",
			addressLine1: params.addressLine1 ?? "Via Roma 1",
			city: params.city ?? "Roma",
			zipCode: params.zipCode ?? "00100",
			country: "IT",
			isDefault: params.isDefault ?? false,
		})
		.returning();

	return addr;
}
