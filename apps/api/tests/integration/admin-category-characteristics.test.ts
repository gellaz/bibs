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
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import {
	listAdminProductCategories,
	listCategoryCharacteristics,
	removeCategoryCharacteristic,
	setCategoryCharacteristic,
} from "@/modules/admin/services/category-characteristics";
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

// Smartphone con Modello e Peso nella matrice, Tablet con niente; un prodotto
// Smartphone con un Peso, un prodotto Tablet con un Peso (fuori matrice: è
// esattamente il valore che non deve essere contato per Smartphone).
async function seedMatrix() {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const phones = await createTestCategory(db, "Smartphone", macro.id);
	const tablets = await createTestCategory(db, "Tablet", macro.id);
	const [modello, peso, colore] = await db
		.insert(productCharacteristic)
		.values([
			{ name: "Modello", dataType: "text" },
			{ name: "Peso", dataType: "number", unit: "g" },
			{ name: "Colore", dataType: "text" },
		])
		.returning();
	await db.insert(productCategoryCharacteristic).values([
		{
			productCategoryId: phones.id,
			characteristicId: modello.id,
			sortOrder: 0,
		},
		{ productCategoryId: phones.id, characteristicId: peso.id, sortOrder: 1 },
	]);
	const seller = await createTestSeller(db);
	const phone = await createTestProduct(db, seller.profile.id, {
		name: "Telefono",
		categoryIds: [phones.id],
	});
	const tablet = await createTestProduct(db, seller.profile.id, {
		name: "Tablet",
		categoryIds: [tablets.id],
	});
	await db.insert(productCharacteristicValue).values([
		{
			productId: phone.id,
			characteristicId: peso.id,
			dataType: "number",
			valueNumber: "180",
		},
		{
			productId: tablet.id,
			characteristicId: peso.id,
			dataType: "number",
			valueNumber: "450",
		},
	]);
	return { macro, phones, tablets, modello, peso, colore, phone };
}

describe("listAdminProductCategories", () => {
	it("counts the characteristics of each subcategory separately", async () => {
		const { phones, tablets } = await seedMatrix();

		const result = await listAdminProductCategories({
			sortBy: "name",
			sortOrder: "asc",
		});

		const byId = new Map(result.data.map((c) => [c.id, c]));
		expect(byId.get(phones.id)?.characteristicCount).toBe(2);
		expect(byId.get(tablets.id)?.characteristicCount).toBe(0);
		expect(byId.get(phones.id)?.macroCategory.name).toBe("Elettronica");
		expect(result.pagination.total).toBe(2);
	});

	it("keeps search and macro filter working with the join", async () => {
		const { macro, phones } = await seedMatrix();
		const other = await createTestMacroCategory(getTestDb(), "Casa");
		await createTestCategory(getTestDb(), "Smart home", other.id);

		const result = await listAdminProductCategories({
			search: "smart",
			macroCategoryId: macro.id,
		});

		expect(result.data.map((c) => c.id)).toEqual([phones.id]);
		expect(result.pagination.total).toBe(1);
	});
});

describe("listCategoryCharacteristics", () => {
	it("returns the whole dictionary with inclusion state and in-category value counts", async () => {
		const { phones } = await seedMatrix();

		const rows = await listCategoryCharacteristics(phones.id);

		expect(rows.map((r) => [r.name, r.included, r.valueCount])).toEqual([
			["Colore", false, 0],
			["Modello", true, 0],
			["Peso", true, 1],
		]);
	});

	it("returns 404 for an unknown subcategory", async () => {
		expect(
			(await caught(() => listCategoryCharacteristics("missing"))).status,
		).toBe(404);
	});
});

describe("setCategoryCharacteristic", () => {
	it("appends a new link at the end of the subcategory", async () => {
		const { phones, colore } = await seedMatrix();

		const link = await setCategoryCharacteristic({
			productCategoryId: phones.id,
			characteristicId: colore.id,
			required: false,
		});

		expect(link.sortOrder).toBe(2);
		expect(link.required).toBe(false);
	});

	it("updates required on an existing link without moving it", async () => {
		const { phones, modello } = await seedMatrix();

		const link = await setCategoryCharacteristic({
			productCategoryId: phones.id,
			characteristicId: modello.id,
			required: true,
		});

		expect(link.required).toBe(true);
		expect(link.sortOrder).toBe(0);
	});

	it("starts at zero on an empty subcategory", async () => {
		const { tablets, colore } = await seedMatrix();

		const link = await setCategoryCharacteristic({
			productCategoryId: tablets.id,
			characteristicId: colore.id,
			required: false,
		});

		expect(link.sortOrder).toBe(0);
	});

	it("returns 404 instead of a foreign key error for unknown ids", async () => {
		const { phones, colore } = await seedMatrix();

		expect(
			(
				await caught(() =>
					setCategoryCharacteristic({
						productCategoryId: "missing",
						characteristicId: colore.id,
						required: false,
					}),
				)
			).status,
		).toBe(404);
		expect(
			(
				await caught(() =>
					setCategoryCharacteristic({
						productCategoryId: phones.id,
						characteristicId: "missing",
						required: false,
					}),
				)
			).status,
		).toBe(404);
	});
});

describe("removeCategoryCharacteristic", () => {
	it("refuses with 409 when products of the subcategory have a value", async () => {
		const { phones, peso } = await seedMatrix();

		const err = await caught(() =>
			removeCategoryCharacteristic({
				productCategoryId: phones.id,
				characteristicId: peso.id,
				confirmAffected: 0,
			}),
		);

		expect(err.status).toBe(409);
		expect(
			await getTestDb().select().from(productCategoryCharacteristic),
		).toHaveLength(2);
	});

	it("deletes the link and only the values of that subcategory once confirmed", async () => {
		const { phones, peso, phone } = await seedMatrix();

		const { deletedValues } = await removeCategoryCharacteristic({
			productCategoryId: phones.id,
			characteristicId: peso.id,
			confirmAffected: 1,
		});

		expect(deletedValues).toBe(1);
		const values = await getTestDb().select().from(productCharacteristicValue);
		expect(values).toHaveLength(1);
		expect(values[0].productId).not.toBe(phone.id);
		const links = await getTestDb()
			.select()
			.from(productCategoryCharacteristic)
			.where(eq(productCategoryCharacteristic.productCategoryId, phones.id));
		expect(links).toHaveLength(1);
	});

	it("returns 404 when the characteristic is not in the subcategory", async () => {
		const { phones, colore } = await seedMatrix();

		const err = await caught(() =>
			removeCategoryCharacteristic({
				productCategoryId: phones.id,
				characteristicId: colore.id,
				confirmAffected: 0,
			}),
		);

		expect(err.status).toBe(404);
	});
});
