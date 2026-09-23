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

import { eq } from "drizzle-orm";
import {
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { importCharacteristicsFromCsv } from "@/modules/admin/services/characteristic-import";
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

describe("importCharacteristicsFromCsv", () => {
	it("creates characteristics with their options", async () => {
		const csv = [
			"name,data_type,unit,options",
			"Colore,enum,,Rosso|Blu|Verde",
			"Peso,number,g,",
			"5G,boolean,,",
			"Modello,text,,",
		].join("\n");

		const result = await importCharacteristicsFromCsv(csv);

		expect(result.created).toBe(4);
		expect(result.failed).toBe(0);
		const rows = await getTestDb().select().from(productCharacteristic);
		expect(rows).toHaveLength(4);
		const colore = rows.find((r) => r.name === "Colore");
		const opts = await getTestDb()
			.select()
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.characteristicId, colore!.id));
		expect(opts.map((o) => o.value).sort()).toEqual(["Blu", "Rosso", "Verde"]);
	});

	it("updates an existing characteristic instead of skipping it", async () => {
		await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Peso,number,kg,"].join("\n"),
		);

		const result = await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Peso,number,g,"].join("\n"),
		);

		expect(result.created).toBe(0);
		const [row] = await getTestDb().select().from(productCharacteristic);
		expect(row.unit).toBe("g");
	});

	it("replaces the option list on update", async () => {
		await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Colore,enum,,Rosso|Blu"].join("\n"),
		);

		await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Colore,enum,,Rosso|Verde"].join("\n"),
		);

		const opts = await getTestDb().select().from(productCharacteristicOption);
		expect(opts.map((o) => o.value).sort()).toEqual(["Rosso", "Verde"]);
	});

	it("refuses a type change on a characteristic that already has values", async () => {
		const db = getTestDb();
		await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Peso,text,,"].join("\n"),
		);
		const [c] = await db.select().from(productCharacteristic);
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, { name: "P" });
		await db.insert(productCharacteristicValue).values({
			productId: p.id,
			characteristicId: c.id,
			dataType: "text",
			valueText: "pesante",
		});

		const result = await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Peso,number,g,"].join("\n"),
		);

		expect(result.failed).toBe(1);
		expect(result.errors[0].message).toContain("Peso");
		expect(result.errors[0].message).toContain("1");
		const [after] = await db.select().from(productCharacteristic);
		expect(after.dataType).toBe("text");
	});

	it("reports the row number of an invalid data type", async () => {
		const csv = [
			"name,data_type,unit,options",
			"Colore,enum,,Rosso|Blu",
			"Peso,quantita,,",
		].join("\n");

		const result = await importCharacteristicsFromCsv(csv);

		expect(result.created).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.errors[0].row).toBe(3);
	});

	it("rejects an enum row with no options", async () => {
		const result = await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Colore,enum,,"].join("\n"),
		);

		expect(result.created).toBe(0);
		expect(result.failed).toBe(1);
	});

	it("refuses removing an option still referenced by a product value", async () => {
		const db = getTestDb();
		await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Colore,enum,,Rosso|Blu"].join("\n"),
		);
		const [c] = await db.select().from(productCharacteristic);
		const options = await db
			.select()
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.characteristicId, c.id));
		const rosso = options.find((o) => o.value === "Rosso")!;
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, { name: "P" });
		await db.insert(productCharacteristicValue).values({
			productId: p.id,
			characteristicId: c.id,
			dataType: "enum",
			optionId: rosso.id,
		});

		const result = await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Colore,enum,,Blu"].join("\n"),
		);

		expect(result.failed).toBe(1);
		expect(result.errors[0].message).toContain("Colore");
		expect(result.errors[0].message).toContain("1");
		const remainingOptions = await db
			.select()
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.characteristicId, c.id));
		expect(remainingOptions.map((o) => o.value).sort()).toEqual([
			"Blu",
			"Rosso",
		]);
	});

	it("succeeds re-importing an unchanged option list on a characteristic with values", async () => {
		const db = getTestDb();
		await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Colore,enum,,Rosso|Blu"].join("\n"),
		);
		const [c] = await db.select().from(productCharacteristic);
		const options = await db
			.select()
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.characteristicId, c.id));
		const rosso = options.find((o) => o.value === "Rosso")!;
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, { name: "P" });
		await db.insert(productCharacteristicValue).values({
			productId: p.id,
			characteristicId: c.id,
			dataType: "enum",
			optionId: rosso.id,
		});

		const result = await importCharacteristicsFromCsv(
			["name,data_type,unit,options", "Colore,enum,,Rosso|Blu"].join("\n"),
		);

		expect(result.failed).toBe(0);
		expect(result.updated).toBe(1);
		const remainingOptions = await db
			.select()
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.characteristicId, c.id));
		expect(remainingOptions.map((o) => o.value).sort()).toEqual([
			"Blu",
			"Rosso",
		]);
		// L'id dell'opzione referenziata resta lo stesso: il valore prodotto
		// creato sopra continua a puntare a un'opzione viva.
		expect(remainingOptions.find((o) => o.value === "Rosso")?.id).toBe(
			rosso.id,
		);
	});
});
