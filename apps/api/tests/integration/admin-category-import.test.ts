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

import { count, eq } from "drizzle-orm";
import { productCategory } from "@/db/schemas/category";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { storeCategory } from "@/db/schemas/store-category";
import { ServiceError } from "@/lib/errors";
import {
	importProductCategoriesFromCsv,
	importStoreCategoriesFromCsv,
} from "@/modules/admin/services/category-import";
import {
	createProductMacroCategory,
	deleteProductMacroCategory,
} from "@/modules/admin/services/product-macro-categories";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestMacroCategory,
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

// ── importProductCategoriesFromCsv ────────────────────────────────────────────

describe("importProductCategoriesFromCsv", () => {
	it("creates new macro and sub categories from CSV", async () => {
		const csv = [
			"macro_category,subcategory",
			"Elettronica,Smartphone",
			"Elettronica,Tablet",
			"Casa,Lampade",
		].join("\n");

		const result = await importProductCategoriesFromCsv(csv);

		expect(result.failed).toBe(0);
		expect(result.skipped).toBe(0);
		// 2 macros + 3 subs
		expect(result.created).toBe(5);

		const db = getTestDb();
		const [{ macroTotal }] = await db
			.select({ macroTotal: count() })
			.from(productMacroCategory);
		const [{ subTotal }] = await db
			.select({ subTotal: count() })
			.from(productCategory);

		expect(macroTotal).toBe(2);
		expect(subTotal).toBe(3);
	});

	it("is idempotent: re-importing the same CSV creates nothing", async () => {
		const csv = [
			"macro_category,subcategory",
			"Elettronica,Smartphone",
			"Elettronica,Tablet",
		].join("\n");

		await importProductCategoriesFromCsv(csv);
		const second = await importProductCategoriesFromCsv(csv);

		expect(second.created).toBe(0);
		expect(second.skipped).toBe(2);
		expect(second.failed).toBe(0);
	});

	it("matches existing categories case-insensitively", async () => {
		await importProductCategoriesFromCsv(
			"macro_category,subcategory\nElettronica,Smartphone",
		);

		const result = await importProductCategoriesFromCsv(
			"macro_category,subcategory\nelettronica,SMARTPHONE",
		);

		expect(result.created).toBe(0);
		expect(result.skipped).toBe(1);
	});

	it("allows the same subcategory name under different macros", async () => {
		const csv = [
			"macro_category,subcategory",
			"Hobby e creatività,Pennelli",
			"Fai da te e industria,Pennelli",
		].join("\n");

		const result = await importProductCategoriesFromCsv(csv);

		expect(result.failed).toBe(0);
		// 2 macros + 2 subs (same name, different macros)
		expect(result.created).toBe(4);

		const db = getTestDb();
		const subs = await db
			.select({ name: productCategory.name })
			.from(productCategory);
		expect(subs).toHaveLength(2);
		expect(subs.every((s) => s.name === "Pennelli")).toBe(true);
	});

	it("rejects CSV with missing required header", async () => {
		await expect(
			importProductCategoriesFromCsv("foo,bar\nx,y"),
		).rejects.toThrow(ServiceError);
	});

	it("rejects CSV with no data rows", async () => {
		await expect(
			importProductCategoriesFromCsv("macro_category,subcategory\n"),
		).rejects.toThrow(ServiceError);
	});

	it("reports row-level errors without blocking valid rows", async () => {
		const csv = [
			"macro_category,subcategory",
			"Elettronica,Smartphone",
			",Orfana", // missing macro
			"Casa,", // missing sub
			"Casa,Lampade",
		].join("\n");

		const result = await importProductCategoriesFromCsv(csv);

		expect(result.failed).toBe(2);
		expect(result.errors.map((e) => e.row).sort()).toEqual([3, 4]);
		// 2 macros + 2 valid subs
		expect(result.created).toBe(4);
	});

	it("dedupes identical rows within the same CSV", async () => {
		const csv = [
			"macro_category,subcategory",
			"Elettronica,Smartphone",
			"elettronica,smartphone",
			"Elettronica,Smartphone",
		].join("\n");

		const result = await importProductCategoriesFromCsv(csv);

		expect(result.failed).toBe(0);
		expect(result.created).toBe(2); // 1 macro + 1 sub
		expect(result.skipped).toBe(2); // duplicates within CSV
	});
});

// ── importStoreCategoriesFromCsv ──────────────────────────────────────────────

describe("importStoreCategoriesFromCsv", () => {
	it("creates new store categories from CSV", async () => {
		const csv = ["name", "Ristorante", "Barbiere", "Bar"].join("\n");

		const result = await importStoreCategoriesFromCsv(csv);

		expect(result.failed).toBe(0);
		expect(result.created).toBe(3);
		expect(result.skipped).toBe(0);

		const db = getTestDb();
		const [{ total }] = await db.select({ total: count() }).from(storeCategory);
		expect(total).toBe(3);
	});

	it("is idempotent", async () => {
		const csv = ["name", "Ristorante", "Barbiere"].join("\n");

		await importStoreCategoriesFromCsv(csv);
		const second = await importStoreCategoriesFromCsv(csv);

		expect(second.created).toBe(0);
		expect(second.skipped).toBe(2);
	});

	it("rejects CSV without `name` header", async () => {
		await expect(importStoreCategoriesFromCsv("foo\nx")).rejects.toThrow(
			ServiceError,
		);
	});

	it("dedupes identical rows within the same CSV (case-insensitive)", async () => {
		const csv = [
			"name",
			"Ristorante",
			"ristorante",
			"RISTORANTE",
			"Barbiere",
		].join("\n");

		const result = await importStoreCategoriesFromCsv(csv);

		expect(result.failed).toBe(0);
		expect(result.created).toBe(2);
		expect(result.skipped).toBe(2);
	});

	it("reports row-level error for whitespace-only quoted name", async () => {
		const csv = ["name", "Ristorante", '"   "', "Barbiere"].join("\n");

		const result = await importStoreCategoriesFromCsv(csv);

		expect(result.failed).toBe(1);
		expect(result.errors[0].row).toBe(3);
		expect(result.created).toBe(2);
	});
});

// ── deleteProductMacroCategory (RESTRICT) ─────────────────────────────────────

describe("deleteProductMacroCategory", () => {
	it("deletes a macro with no sub-categories", async () => {
		const db = getTestDb();
		const macro = await createTestMacroCategory(db, "Solo");

		const deleted = await deleteProductMacroCategory(macro.id);

		expect(deleted.id).toBe(macro.id);
		const remaining = await db.query.productMacroCategory.findFirst({
			where: eq(productMacroCategory.id, macro.id),
		});
		expect(remaining).toBeUndefined();
	});

	it("rejects delete when sub-categories are still attached", async () => {
		const db = getTestDb();
		const macro = await createTestMacroCategory(db, "WithChildren");
		await createTestCategory(db, "Child A", macro.id);
		await createTestCategory(db, "Child B", macro.id);

		await expect(deleteProductMacroCategory(macro.id)).rejects.toMatchObject({
			status: 409,
		});

		const stillThere = await db.query.productMacroCategory.findFirst({
			where: eq(productMacroCategory.id, macro.id),
		});
		expect(stillThere).toBeDefined();
	});

	it("returns 404 when macro does not exist", async () => {
		await expect(
			deleteProductMacroCategory("non-existent-id"),
		).rejects.toMatchObject({
			status: 404,
		});
	});
});

// ── createProductMacroCategory uniqueness ─────────────────────────────────────

describe("createProductMacroCategory", () => {
	it("creates a macro and rejects duplicate names via unique constraint", async () => {
		const m1 = await createProductMacroCategory("Elettronica");
		expect(m1.name).toBe("Elettronica");

		await expect(createProductMacroCategory("Elettronica")).rejects.toThrow();
	});
});
