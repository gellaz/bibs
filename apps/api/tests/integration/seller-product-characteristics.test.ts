import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

mock.module("@/lib/s3", () => ({
	s3: { delete: mock(async () => {}) },
}));

import { eq } from "drizzle-orm";
import { product } from "@/db/schemas/product";
import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import {
	getFormCharacteristics,
	listProductCharacteristicValues,
} from "@/modules/seller/services/product-characteristics";
import {
	createProduct,
	getProduct,
	updateProduct,
} from "@/modules/seller/services/products";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestMacroCategory,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function caught(fn: () => Promise<unknown>): Promise<ServiceError> {
	try {
		await fn();
	} catch (e) {
		if (e instanceof ServiceError) return e;
		throw e;
	}
	throw new Error("expected a ServiceError");
}

async function seedCatalog() {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const phones = await createTestCategory(db, "Smartphone", macro.id);
	const tablets = await createTestCategory(db, "Tablet", macro.id);
	const [peso, modello, g5, colore] = await db
		.insert(productCharacteristic)
		.values([
			{ name: "Peso", dataType: "number", unit: "g" },
			{ name: "Modello", dataType: "text" },
			{ name: "5G", dataType: "boolean" },
			{ name: "Colore", dataType: "enum" },
		])
		.returning();
	const [bianco, nero] = await db
		.insert(productCharacteristicOption)
		.values([
			{ characteristicId: colore.id, value: "Bianco", sortOrder: 1 },
			{ characteristicId: colore.id, value: "Nero", sortOrder: 0 },
		])
		.returning();
	await db.insert(productCategoryCharacteristic).values([
		{ productCategoryId: phones.id, characteristicId: peso.id, sortOrder: 0 },
		{
			productCategoryId: phones.id,
			characteristicId: modello.id,
			sortOrder: 1,
			required: true,
		},
		// Stesso sortOrder: decide il nome, «5G» prima di «Colore».
		{ productCategoryId: phones.id, characteristicId: colore.id, sortOrder: 2 },
		{ productCategoryId: phones.id, characteristicId: g5.id, sortOrder: 2 },
		{
			productCategoryId: tablets.id,
			characteristicId: colore.id,
			sortOrder: 0,
		},
		{ productCategoryId: tablets.id, characteristicId: peso.id, sortOrder: 1 },
	]);
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	return {
		db,
		phones,
		tablets,
		peso,
		modello,
		g5,
		colore,
		bianco,
		nero,
		seller,
		store,
	};
}

/** Un prodotto Smartphone con tutti e quattro i valori, inseriti a mano. */
async function seedPhoneWithValues(c: Awaited<ReturnType<typeof seedCatalog>>) {
	const p = await createTestProduct(c.db, c.seller.profile.id, {
		name: "Telefono",
		categoryIds: [c.phones.id],
	});
	await createTestStoreProduct(c.db, c.store.id, p.id);
	await c.db.insert(productCharacteristicValue).values([
		{
			productId: p.id,
			characteristicId: c.peso.id,
			dataType: "number",
			valueNumber: "180",
		},
		{
			productId: p.id,
			characteristicId: c.modello.id,
			dataType: "text",
			valueText: "X1",
		},
		{
			productId: p.id,
			characteristicId: c.g5.id,
			dataType: "boolean",
			valueBoolean: true,
		},
		{
			productId: p.id,
			characteristicId: c.colore.id,
			dataType: "enum",
			optionId: c.nero.id,
		},
	]);
	return p;
}

async function valuesOf(productId: string) {
	const rows = await getTestDb()
		.select({ id: productCharacteristicValue.characteristicId })
		.from(productCharacteristicValue)
		.where(eq(productCharacteristicValue.productId, productId));
	return new Set(rows.map((r) => r.id));
}

describe("getFormCharacteristics", () => {
	it("orders by sortOrder, then by name, with the options of closed lists", async () => {
		const c = await seedCatalog();

		const result = await getFormCharacteristics(c.phones.id);

		expect(result.map((r) => r.name)).toEqual([
			"Peso",
			"Modello",
			"5G",
			"Colore",
		]);
		const byName = new Map(result.map((r) => [r.name, r]));
		expect(byName.get("Peso")).toMatchObject({
			dataType: "number",
			unit: "g",
			required: false,
			options: [],
		});
		expect(byName.get("Modello")?.required).toBe(true);
		expect(byName.get("Colore")?.options).toEqual([
			{ id: c.nero.id, value: "Nero" },
			{ id: c.bianco.id, value: "Bianco" },
		]);
	});

	it("returns only the characteristics of that subcategory", async () => {
		const c = await seedCatalog();
		const result = await getFormCharacteristics(c.tablets.id);
		expect(result.map((r) => r.name)).toEqual(["Colore", "Peso"]);
	});

	it("answers 404 for an unknown subcategory", async () => {
		await seedCatalog();
		const err = await caught(() => getFormCharacteristics("nope"));
		expect(err.status).toBe(404);
	});
});

describe("product detail values", () => {
	it("returns the saved values with names and typed values", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		const found = await getProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
		});

		expect(found.characteristicValues).toEqual([
			{ characteristicId: c.g5.id, name: "5G", value: true },
			{ characteristicId: c.colore.id, name: "Colore", value: c.nero.id },
			{ characteristicId: c.modello.id, name: "Modello", value: "X1" },
			{ characteristicId: c.peso.id, name: "Peso", value: 180 },
		]);
	});

	it("returns an empty list for a product without values", async () => {
		const c = await seedCatalog();
		const p = await createTestProduct(c.db, c.seller.profile.id, {
			categoryIds: [c.phones.id],
		});
		expect(await listProductCharacteristicValues(p.id)).toEqual([]);
	});
});

describe("createProduct with characteristics", () => {
	it("stores one value per type", async () => {
		const c = await seedCatalog();

		const created = await createProduct({
			sellerProfileId: c.seller.profile.id,
			storeId: c.store.id,
			name: "Telefono",
			price: "199.00",
			productCategoryId: c.phones.id,
			characteristicValues: [
				{ characteristicId: c.peso.id, value: 180 },
				{ characteristicId: c.modello.id, value: "X1" },
				{ characteristicId: c.g5.id, value: false },
				{ characteristicId: c.colore.id, value: c.bianco.id },
			],
		});

		expect(await listProductCharacteristicValues(created.id)).toEqual([
			{ characteristicId: c.g5.id, name: "5G", value: false },
			{ characteristicId: c.colore.id, name: "Colore", value: c.bianco.id },
			{ characteristicId: c.modello.id, name: "Modello", value: "X1" },
			{ characteristicId: c.peso.id, name: "Peso", value: 180 },
		]);
	});

	it("saves a product with an empty section when nothing is required (D8)", async () => {
		const c = await seedCatalog();
		const created = await createProduct({
			sellerProfileId: c.seller.profile.id,
			storeId: c.store.id,
			name: "Tablet",
			price: "299.00",
			productCategoryId: c.tablets.id,
		});
		expect((await valuesOf(created.id)).size).toBe(0);
	});

	it("refuses a new product that leaves a required characteristic empty", async () => {
		const c = await seedCatalog();

		const err = await caught(() =>
			createProduct({
				sellerProfileId: c.seller.profile.id,
				storeId: c.store.id,
				name: "Telefono",
				price: "199.00",
				productCategoryId: c.phones.id,
				characteristicValues: [{ characteristicId: c.peso.id, value: 180 }],
			}),
		);

		expect(err.status).toBe(400);
		expect(err.message).toContain("Modello");
		// La transazione è annullata: nessun prodotto a metà.
		const rows = await c.db.select().from(product);
		expect(rows).toHaveLength(0);
	});

	it("refuses an invalid value and writes nothing", async () => {
		const c = await seedCatalog();

		const err = await caught(() =>
			createProduct({
				sellerProfileId: c.seller.profile.id,
				storeId: c.store.id,
				name: "Telefono",
				price: "199.00",
				productCategoryId: c.phones.id,
				characteristicValues: [
					{ characteristicId: c.modello.id, value: "X1" },
					{ characteristicId: c.peso.id, value: "tanto" },
				],
			}),
		);

		expect(err.status).toBe(400);
		expect(err.message).toContain("Peso: atteso un numero");
		expect(await c.db.select().from(product)).toHaveLength(0);
	});

	it("refuses values on a product without a subcategory", async () => {
		const c = await seedCatalog();

		const err = await caught(() =>
			createProduct({
				sellerProfileId: c.seller.profile.id,
				storeId: c.store.id,
				name: "Senza categoria",
				price: "1.00",
				productCategoryId: null,
				characteristicValues: [{ characteristicId: c.peso.id, value: 1 }],
			}),
		);

		expect(err.status).toBe(400);
		expect(err.message).toContain("non prevista");
	});
});

describe("updateProduct in the same subcategory", () => {
	it("updates, clears and leaves alone according to the list", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			productCategoryId: c.phones.id,
			characteristicValues: [
				{ characteristicId: c.peso.id, value: 200 },
				{ characteristicId: c.g5.id, value: null },
			],
		});

		expect(await listProductCharacteristicValues(p.id)).toEqual([
			{ characteristicId: c.colore.id, name: "Colore", value: c.nero.id },
			{ characteristicId: c.modello.id, name: "Modello", value: "X1" },
			{ characteristicId: c.peso.id, name: "Peso", value: 200 },
		]);
	});

	it("leaves values alone when the list is omitted", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			name: "Nuovo nome",
		});

		expect((await valuesOf(p.id)).size).toBe(4);
	});

	it("tolerates a required characteristic that was never filled (P1)", async () => {
		const c = await seedCatalog();
		const p = await createTestProduct(c.db, c.seller.profile.id, {
			categoryIds: [c.phones.id],
		});
		await createTestStoreProduct(c.db, c.store.id, p.id);

		const updated = await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			productCategoryId: c.phones.id,
			price: "12.00",
			characteristicValues: [
				{ characteristicId: c.peso.id, value: 150 },
				{ characteristicId: c.modello.id, value: null },
			],
		});

		expect(updated?.price).toBe("12.00");
		expect([...(await valuesOf(p.id))]).toEqual([c.peso.id]);
	});

	it("refuses to clear a required characteristic already filled", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		const err = await caught(() =>
			updateProduct({
				productId: p.id,
				sellerProfileId: c.seller.profile.id,
				accessibleStoreIds: [c.store.id],
				productCategoryId: c.phones.id,
				characteristicValues: [{ characteristicId: c.modello.id, value: "" }],
			}),
		);

		expect(err.status).toBe(400);
		expect(err.message).toContain("Non puoi svuotare");
		expect(err.message).toContain("Modello");
		expect((await valuesOf(p.id)).has(c.modello.id)).toBe(true);
	});
});
