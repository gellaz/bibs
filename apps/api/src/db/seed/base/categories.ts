import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { count } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { storeCategory } from "@/db/schemas/store-category";
import {
	importProductCategoriesFromCsv,
	importStoreCategoriesFromCsv,
} from "@/modules/admin/services/category-import";

// CSV files live at the repo root and are committed alongside the code.
const REPO_ROOT = resolve(import.meta.dir, "../../../../../..");
const PRODUCT_CATEGORIES_CSV = resolve(REPO_ROOT, "product_categories.csv");
const STORE_CATEGORIES_CSV = resolve(REPO_ROOT, "store_categories.csv");

export async function seedStoreCategories() {
	const [{ total }] = await db.select({ total: count() }).from(storeCategory);
	if (total > 0) {
		console.log("  ⏭ Store categories already seeded, skipping");
		return;
	}

	console.log("  🏷️ Seeding store categories from CSV...");
	const csv = readFileSync(STORE_CATEGORIES_CSV, "utf8");
	const result = await importStoreCategoriesFromCsv(csv);
	console.log(
		`     ✓ ${result.created} store categories (skipped: ${result.skipped}, failed: ${result.failed})`,
	);
}

export async function seedProductCategories() {
	const [[{ macroTotal }], [{ subTotal }]] = await Promise.all([
		db.select({ macroTotal: count() }).from(productMacroCategory),
		db.select({ subTotal: count() }).from(productCategory),
	]);
	if (macroTotal > 0 || subTotal > 0) {
		console.log("  ⏭ Product categories already seeded, skipping");
		return;
	}

	console.log("  🏷️ Seeding product categories from CSV...");
	const csv = readFileSync(PRODUCT_CATEGORIES_CSV, "utf8");
	const result = await importProductCategoriesFromCsv(csv);
	console.log(
		`     ✓ ${result.created} product categories (skipped: ${result.skipped}, failed: ${result.failed})`,
	);
}
