import { eq } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import {
	type ListByNameParams,
	listByNamePaged,
} from "@/lib/list-by-name-paged";

interface ListProductCategoriesParams extends ListByNameParams {
	macroCategoryId?: string;
}

export async function listProductCategories(
	params: ListProductCategoriesParams,
) {
	return listByNamePaged(
		productCategory,
		params,
		(opts) =>
			db.query.productCategory.findMany({
				...opts,
				with: { macroCategory: true },
			}),
		[
			params.macroCategoryId
				? eq(productCategory.macroCategoryId, params.macroCategoryId)
				: undefined,
		],
	);
}
