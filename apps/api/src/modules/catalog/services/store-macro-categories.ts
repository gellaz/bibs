import { db } from "@/db";
import { storeMacroCategory } from "@/db/schemas/store-macro-category";
import {
	type ListByNameParams,
	listByNamePaged,
} from "@/lib/list-by-name-paged";

export async function listStoreMacroCategories(params: ListByNameParams) {
	return listByNamePaged(storeMacroCategory, params, (opts) =>
		db.query.storeMacroCategory.findMany(opts),
	);
}
