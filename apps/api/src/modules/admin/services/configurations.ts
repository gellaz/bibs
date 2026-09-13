import { count } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { storeCategory } from "@/db/schemas/store-category";
import { storeMacroCategory } from "@/db/schemas/store-macro-category";

export async function countConfigurations() {
	const [
		[{ productCategories }],
		[{ productMacroCategories }],
		[{ storeCategories }],
		[{ storeMacroCategories }],
	] = await Promise.all([
		db.select({ productCategories: count() }).from(productCategory),
		db.select({ productMacroCategories: count() }).from(productMacroCategory),
		db.select({ storeCategories: count() }).from(storeCategory),
		db.select({ storeMacroCategories: count() }).from(storeMacroCategory),
	]);

	return {
		productCategories,
		productMacroCategories,
		storeCategories,
		storeMacroCategories,
	};
}
