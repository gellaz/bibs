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

import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { listCustomerCharacteristics } from "@/modules/customer/services/product-characteristics";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestMacroCategory,
	createTestProduct,
	createTestSeller,
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

async function seedCatalog() {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const phones = await createTestCategory(db, "Smartphone", macro.id);
	const tablets = await createTestCategory(db, "Tablet", macro.id);
	const [peso, scadenza, g5, colore, dual] = await db
		.insert(productCharacteristic)
		.values([
			{ name: "Peso", dataType: "number", unit: "g" },
			{ name: "Scadenza/TMC", dataType: "text" },
			{ name: "5G", dataType: "boolean" },
			{ name: "Colore", dataType: "enum" },
			{ name: "Dual SIM", dataType: "boolean" },
		])
		.returning();
	const [nero] = await db
		.insert(productCharacteristicOption)
		.values([{ characteristicId: colore.id, value: "Nero", sortOrder: 0 }])
		.returning();
	await db.insert(productCategoryCharacteristic).values([
		{ productCategoryId: phones.id, characteristicId: peso.id, sortOrder: 0 },
		{
			productCategoryId: phones.id,
			characteristicId: scadenza.id,
			sortOrder: 1,
		},
		// Stesso sortOrder: decide il nome, «5G» prima di «Colore».
		{ productCategoryId: phones.id, characteristicId: colore.id, sortOrder: 2 },
		{ productCategoryId: phones.id, characteristicId: g5.id, sortOrder: 2 },
		{
			productCategoryId: phones.id,
			characteristicId: dual.id,
			sortOrder: 3,
			required: true,
		},
		{ productCategoryId: tablets.id, characteristicId: peso.id, sortOrder: 0 },
	]);
	const seller = await createTestSeller(db);
	const phone = await createTestProduct(db, seller.profile.id, {
		name: "Telefono",
		categoryIds: [phones.id],
	});
	return {
		db,
		phones,
		tablets,
		peso,
		scadenza,
		g5,
		colore,
		dual,
		nero,
		seller,
		phone,
	};
}

describe("listCustomerCharacteristics", () => {
	it("returns only valued characteristics, in matrix order", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values([
			{
				productId: c.phone.id,
				characteristicId: c.colore.id,
				dataType: "enum",
				optionId: c.nero.id,
			},
			{
				productId: c.phone.id,
				characteristicId: c.g5.id,
				dataType: "boolean",
				valueBoolean: true,
			},
			{
				productId: c.phone.id,
				characteristicId: c.peso.id,
				dataType: "number",
				valueNumber: "180.5000",
			},
		]);

		const rows = await listCustomerCharacteristics(c.phone.id, c.phones.id);

		expect(rows.map((r) => r.name)).toEqual(["Peso", "5G", "Colore"]);
		expect(rows[0]).toEqual({
			characteristicId: c.peso.id,
			name: "Peso",
			dataType: "number",
			unit: "g",
			value: 180.5,
		});
	});

	it("returns the option label, not the option id", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values({
			productId: c.phone.id,
			characteristicId: c.colore.id,
			dataType: "enum",
			optionId: c.nero.id,
		});

		const [row] = await listCustomerCharacteristics(c.phone.id, c.phones.id);

		expect(row.value).toBe("Nero");
		expect(row.unit).toBeNull();
	});

	it("keeps a boolean false", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values({
			productId: c.phone.id,
			characteristicId: c.g5.id,
			dataType: "boolean",
			valueBoolean: false,
		});

		const rows = await listCustomerCharacteristics(c.phone.id, c.phones.id);

		expect(rows).toHaveLength(1);
		expect(rows[0].value).toBe(false);
	});

	it("returns a date-like text exactly as stored", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values({
			productId: c.phone.id,
			characteristicId: c.scadenza.id,
			dataType: "text",
			valueText: "05/03/2027",
		});

		const [row] = await listCustomerCharacteristics(c.phone.id, c.phones.id);

		expect(row.value).toBe("05/03/2027");
	});

	it("does not require required characteristics", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values({
			productId: c.phone.id,
			characteristicId: c.peso.id,
			dataType: "number",
			valueNumber: "100",
		});

		const rows = await listCustomerCharacteristics(c.phone.id, c.phones.id);

		// «Dual SIM» è obbligatoria e vuota: semplicemente non c'è.
		expect(rows.map((r) => r.name)).toEqual(["Peso"]);
	});

	it("returns nothing for a product without a subcategory", async () => {
		const c = await seedCatalog();
		const bare = await createTestProduct(c.db, c.seller.profile.id);

		expect(await listCustomerCharacteristics(bare.id, null)).toEqual([]);
	});

	it("hides a value outside the current matrix", async () => {
		const c = await seedCatalog();
		// D10 lo vieta nel service del seller; qui lo si forza a mano per
		// dimostrare che la scheda non mostra un valore dormiente.
		await c.db.insert(productCharacteristicValue).values([
			{
				productId: c.phone.id,
				characteristicId: c.peso.id,
				dataType: "number",
				valueNumber: "100",
			},
			{
				productId: c.phone.id,
				characteristicId: c.g5.id,
				dataType: "boolean",
				valueBoolean: true,
			},
		]);

		// Il prodotto letto come se fosse Tablet, la cui matrice ha solo Peso.
		const rows = await listCustomerCharacteristics(c.phone.id, c.tablets.id);

		expect(rows.map((r) => r.name)).toEqual(["Peso"]);
	});
});
