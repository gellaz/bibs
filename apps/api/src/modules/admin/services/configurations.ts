import { count } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { storeCategory } from "@/db/schemas/store-category";

export async function countConfigurations() {
	const [[{ productCategories }], [{ storeCategories }]] = await Promise.all([
		db.select({ productCategories: count() }).from(productCategory),
		db.select({ storeCategories: count() }).from(storeCategory),
	]);

	return { productCategories, storeCategories };
}
