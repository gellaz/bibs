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
import { getProduct } from "@/modules/seller/services/products";
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
