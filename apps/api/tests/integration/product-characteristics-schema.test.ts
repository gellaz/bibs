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
	productCharacteristic,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { truncateAll } from "../helpers/cleanup";
import { createTestProduct, createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("product characteristic constraints", () => {
	it("rejects a value whose column does not match its data type", async () => {
		const db = getTestDb();
		const [c] = await db
			.insert(productCharacteristic)
			.values({ name: "Peso", dataType: "number", unit: "g" })
			.returning();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, { name: "P" });

		// numero dichiarato, ma valorizzata la colonna di testo
		// Wrap in an async fn so a real Promise (not the Drizzle query builder
		// thenable) reaches expect().rejects — see db-enum-check-constraints.test.ts.
		const insertBad = async () =>
			db.insert(productCharacteristicValue).values({
				productId: p.id,
				characteristicId: c.id,
				dataType: "number",
				valueText: "pesante",
			});

		await expect(insertBad()).rejects.toThrow();
	});

	it("rejects a value whose data type diverges from the dictionary", async () => {
		const db = getTestDb();
		const [c] = await db
			.insert(productCharacteristic)
			.values({ name: "5G", dataType: "boolean" })
			.returning();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, { name: "P" });

		// la copia denormalizzata mente sul tipo: la chiave esterna composta deve rifiutare
		const insertBad = async () =>
			db.insert(productCharacteristicValue).values({
				productId: p.id,
				characteristicId: c.id,
				dataType: "text",
				valueText: "sì",
			});

		await expect(insertBad()).rejects.toThrow();
	});

	it("rejects a unit on a characteristic that is not a number", async () => {
		const db = getTestDb();
		const insertBad = async () =>
			db
				.insert(productCharacteristic)
				.values({ name: "Colore", dataType: "enum", unit: "g" });

		await expect(insertBad()).rejects.toThrow();
	});

	it("accepts a well-formed number value", async () => {
		const db = getTestDb();
		const [c] = await db
			.insert(productCharacteristic)
			.values({ name: "Peso", dataType: "number", unit: "g" })
			.returning();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, { name: "P" });

		const [v] = await db
			.insert(productCharacteristicValue)
			.values({
				productId: p.id,
				characteristicId: c.id,
				dataType: "number",
				valueNumber: "1250.0000",
			})
			.returning();

		expect(v.valueNumber).toBe("1250.0000");
	});
});
