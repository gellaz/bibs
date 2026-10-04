import { db } from "@/db";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import {
	type ListByNameParams,
	listByNamePaged,
} from "@/lib/list-by-name-paged";

export async function listProductMacroCategories(params: ListByNameParams) {
	return listByNamePaged(productMacroCategory, params, (opts) =>
		db.query.productMacroCategory.findMany(opts),
	);
}
