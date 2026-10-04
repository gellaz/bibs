import { eq } from "drizzle-orm";
import { db } from "@/db";
import { storeCategory } from "@/db/schemas/store-category";
import {
	type ListByNameParams,
	listByNamePaged,
} from "@/lib/list-by-name-paged";

interface ListStoreCategoriesParams extends ListByNameParams {
	macroCategoryId?: string;
}

export async function listStoreCategories(params: ListStoreCategoriesParams) {
	return listByNamePaged(
		storeCategory,
		params,
		(opts) =>
			db.query.storeCategory.findMany({
				...opts,
				with: { macroCategory: true },
			}),
		[
			params.macroCategoryId
				? eq(storeCategory.macroCategoryId, params.macroCategoryId)
				: undefined,
		],
	);
}
