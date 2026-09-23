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
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import {
	assertImpactConfirmed,
	countCategoryCharacteristicValues,
	countValuesByCharacteristic,
	countValuesByOption,
	productsPhrase,
	sumCounts,
} from "@/modules/admin/services/characteristic-impact";
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

// Colore (enum Rosso|Blu) e Peso (number) su due sotto-categorie: tre prodotti
// Rosso in Smartphone, uno Blu in Tablet, un Peso in Smartphone.
async function seedValues() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const macro = await createTestMacroCategory(db, "Elettronica");
	const phones = await createTestCategory(db, "Smartphone", macro.id);
	const tablets = await createTestCategory(db, "Tablet", macro.id);

	const [colore] = await db
		.insert(productCharacteristic)
		.values({ name: "Colore", dataType: "enum" })
		.returning();
	const [peso] = await db
		.insert(productCharacteristic)
		.values({ name: "Peso", dataType: "number", unit: "g" })
		.returning();
	const [rosso, blu] = await db
		.insert(productCharacteristicOption)
		.values([
			{ characteristicId: colore.id, value: "Rosso", sortOrder: 0 },
			{ characteristicId: colore.id, value: "Blu", sortOrder: 1 },
		])
		.returning();

	const phoneProducts = [];
	for (const name of ["A", "B", "C"]) {
		phoneProducts.push(
			await createTestProduct(db, seller.profile.id, {
				name,
				categoryIds: [phones.id],
			}),
		);
	}
	const tablet = await createTestProduct(db, seller.profile.id, {
		name: "D",
		categoryIds: [tablets.id],
	});

	await db.insert(productCharacteristicValue).values([
		...phoneProducts.map((p) => ({
			productId: p.id,
			characteristicId: colore.id,
			dataType: "enum" as const,
			optionId: rosso.id,
		})),
		{
			productId: tablet.id,
			characteristicId: colore.id,
			dataType: "enum" as const,
			optionId: blu.id,
		},
		{
			productId: phoneProducts[0].id,
			characteristicId: peso.id,
			dataType: "number" as const,
			valueNumber: "180",
		},
	]);

	return { phones, tablets, colore, peso, rosso, blu };
}

describe("countValuesByCharacteristic", () => {
	it("counts values per characteristic and omits the ones without values", async () => {
		const { colore, peso } = await seedValues();
		const [{ id: vuota }] = await getTestDb()
			.insert(productCharacteristic)
			.values({ name: "Modello", dataType: "text" })
			.returning();

		const counts = await countValuesByCharacteristic([
			colore.id,
			peso.id,
			vuota,
		]);

		expect(counts.get(colore.id)).toBe(4);
		expect(counts.get(peso.id)).toBe(1);
		expect(counts.has(vuota)).toBe(false);
	});

	it("returns an empty map for an empty id list without querying", async () => {
		expect((await countValuesByCharacteristic([])).size).toBe(0);
	});
});

describe("countValuesByOption", () => {
	it("counts values per option", async () => {
		const { rosso, blu } = await seedValues();

		const counts = await countValuesByOption([rosso.id, blu.id]);

		expect(counts.get(rosso.id)).toBe(3);
		expect(counts.get(blu.id)).toBe(1);
		expect(sumCounts(counts)).toBe(4);
	});
});

describe("countCategoryCharacteristicValues", () => {
	it("counts only the values on products of that subcategory", async () => {
		const { phones, tablets, colore } = await seedValues();

		expect(await countCategoryCharacteristicValues(phones.id, colore.id)).toBe(
			3,
		);
		expect(await countCategoryCharacteristicValues(tablets.id, colore.id)).toBe(
			1,
		);
	});
});

describe("assertImpactConfirmed", () => {
	it("passes when the confirmation covers the impact", () => {
		expect(() => assertImpactConfirmed(0, 0)).not.toThrow();
		expect(() => assertImpactConfirmed(3, 3)).not.toThrow();
		// meno del confermato: si cancella meno di quanto approvato, è sicuro
		expect(() => assertImpactConfirmed(2, 3)).not.toThrow();
	});

	it("rejects with 409 an unconfirmed impact", () => {
		let caught: unknown;
		try {
			assertImpactConfirmed(1, 0);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ServiceError);
		expect((caught as ServiceError).status).toBe(409);
		expect((caught as ServiceError).message).toBe(
			"L'operazione elimina i valori già compilati su 1 prodotto: serve una conferma esplicita.",
		);
	});

	it("rejects with 409 a confirmation that has gone stale", () => {
		let caught: unknown;
		try {
			assertImpactConfirmed(5, 3);
		} catch (e) {
			caught = e;
		}
		expect((caught as ServiceError).status).toBe(409);
		expect((caught as ServiceError).message).toBe(
			"I valori da eliminare sono cambiati: ora riguardano 5 prodotti, la conferma ne copriva 3. Ricarica e conferma di nuovo.",
		);
	});

	it("phrases singular and plural", () => {
		expect(productsPhrase(1)).toBe("1 prodotto");
		expect(productsPhrase(0)).toBe("0 prodotti");
		expect(productsPhrase(12)).toBe("12 prodotti");
	});
});
