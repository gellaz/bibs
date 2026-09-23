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
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import { countConfigurations } from "@/modules/admin/services/configurations";
import {
	createProductCharacteristic,
	deleteProductCharacteristic,
	listProductCharacteristics,
} from "@/modules/admin/services/product-characteristics";
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

async function caught(fn: () => Promise<unknown>): Promise<ServiceError> {
	try {
		await fn();
	} catch (e) {
		if (e instanceof ServiceError) return e;
		throw e;
	}
	throw new Error("expected a ServiceError");
}

// Un prodotto con Colore = Rosso.
async function giveRossoToOneProduct(colore: { id: string }) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const p = await createTestProduct(db, seller.profile.id, { name: "P" });
	const [rosso] = await db
		.select()
		.from(productCharacteristicOption)
		.where(eq(productCharacteristicOption.value, "Rosso"));
	await db.insert(productCharacteristicValue).values({
		productId: p.id,
		characteristicId: colore.id,
		dataType: "enum",
		optionId: rosso.id,
	});
	return { product: p, rosso };
}

describe("createProductCharacteristic", () => {
	it("creates an enum with its options in order", async () => {
		const c = await createProductCharacteristic({
			name: " Colore ",
			dataType: "enum",
			options: [{ value: "Rosso" }, { value: " Blu " }, { value: "" }],
		});

		expect(c.name).toBe("Colore");
		const opts = await getTestDb()
			.select()
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.characteristicId, c.id));
		expect(
			opts.sort((a, b) => a.sortOrder - b.sortOrder).map((o) => o.value),
		).toEqual(["Rosso", "Blu"]);
	});

	it("keeps the unit only for numbers", async () => {
		const peso = await createProductCharacteristic({
			name: "Peso",
			dataType: "number",
			unit: "g",
		});
		expect(peso.unit).toBe("g");

		const err = await caught(() =>
			createProductCharacteristic({
				name: "Modello",
				dataType: "text",
				unit: "g",
			}),
		);
		expect(err.status).toBe(400);
		expect(err.message).toBe(
			`L'unità di misura ha senso solo per il tipo "number"`,
		);
	});

	it("rejects an enum without options, options on a non-enum and duplicates", async () => {
		expect(
			(
				await caught(() =>
					createProductCharacteristic({
						name: "Colore",
						dataType: "enum",
						options: [],
					}),
				)
			).message,
		).toBe(`Il tipo "enum" richiede almeno un'opzione`);
		expect(
			(
				await caught(() =>
					createProductCharacteristic({
						name: "5G",
						dataType: "boolean",
						options: [{ value: "Sì" }],
					}),
				)
			).message,
		).toBe(`Le opzioni hanno senso solo per il tipo "enum"`);
		expect(
			(
				await caught(() =>
					createProductCharacteristic({
						name: "Colore",
						dataType: "enum",
						options: [{ value: "Rosso" }, { value: "Rosso " }],
					}),
				)
			).message,
		).toBe(`Opzione ripetuta: "Rosso"`);
	});
});

describe("listProductCharacteristics", () => {
	it("returns options in order with per-option and per-characteristic value counts", async () => {
		const colore = await createProductCharacteristic({
			name: "Colore",
			dataType: "enum",
			options: [{ value: "Rosso" }, { value: "Blu" }],
		});
		await createProductCharacteristic({
			name: "Peso",
			dataType: "number",
			unit: "g",
		});
		await giveRossoToOneProduct(colore);

		const result = await listProductCharacteristics({
			sortBy: "name",
			sortOrder: "asc",
		});

		expect(result.pagination.total).toBe(2);
		const [c, p] = result.data;
		expect(c.name).toBe("Colore");
		expect(c.valueCount).toBe(1);
		expect(c.options.map((o) => [o.value, o.valueCount])).toEqual([
			["Rosso", 1],
			["Blu", 0],
		]);
		expect(p.name).toBe("Peso");
		expect(p.valueCount).toBe(0);
		expect(p.options).toEqual([]);
	});

	it("filters by data type", async () => {
		await createProductCharacteristic({
			name: "Peso",
			dataType: "number",
			unit: "g",
		});
		await createProductCharacteristic({ name: "Modello", dataType: "text" });

		const result = await listProductCharacteristics({ dataType: "number" });

		expect(result.data.map((c) => c.name)).toEqual(["Peso"]);
		expect(result.pagination.total).toBe(1);
	});
});

describe("deleteProductCharacteristic", () => {
	it("refuses with 409 when products have values and nothing is confirmed", async () => {
		const colore = await createProductCharacteristic({
			name: "Colore",
			dataType: "enum",
			options: [{ value: "Rosso" }],
		});
		await giveRossoToOneProduct(colore);

		const err = await caught(() => deleteProductCharacteristic(colore.id, 0));

		expect(err.status).toBe(409);
		const still = await getTestDb()
			.select()
			.from(productCharacteristic)
			.where(eq(productCharacteristic.id, colore.id));
		expect(still).toHaveLength(1);
		expect(
			await getTestDb().select().from(productCharacteristicValue),
		).toHaveLength(1);
	});

	it("deletes values, options and matrix rows with the definition once confirmed", async () => {
		const db = getTestDb();
		const colore = await createProductCharacteristic({
			name: "Colore",
			dataType: "enum",
			options: [{ value: "Rosso" }],
		});
		await giveRossoToOneProduct(colore);
		const macro = await createTestMacroCategory(db, "Elettronica");
		const cat = await createTestCategory(db, "Smartphone", macro.id);
		await db.insert(productCategoryCharacteristic).values({
			productCategoryId: cat.id,
			characteristicId: colore.id,
			sortOrder: 0,
		});

		const result = await deleteProductCharacteristic(colore.id, 1);

		expect(result.deletedValues).toBe(1);
		expect(await db.select().from(productCharacteristic)).toHaveLength(0);
		expect(await db.select().from(productCharacteristicOption)).toHaveLength(0);
		expect(await db.select().from(productCharacteristicValue)).toHaveLength(0);
		expect(await db.select().from(productCategoryCharacteristic)).toHaveLength(
			0,
		);
	});

	it("returns 404 for an unknown characteristic", async () => {
		const err = await caught(() => deleteProductCharacteristic("missing", 0));
		expect(err.status).toBe(404);
	});
});

describe("countConfigurations", () => {
	it("counts the dictionary", async () => {
		await createProductCharacteristic({ name: "Modello", dataType: "text" });
		expect((await countConfigurations()).productCharacteristics).toBe(1);
	});
});
