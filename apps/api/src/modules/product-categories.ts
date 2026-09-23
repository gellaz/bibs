import { Elysia } from "elysia";
import { ProductCategoryListQuery } from "@/lib/queries";
import { okPage } from "@/lib/responses";
import {
	okPageRes,
	ProductCategoryWithMacroSchema,
	withErrors,
} from "@/lib/schemas";
import { listProductCategories } from "./admin/services/product-categories";

export const productCategoriesModule = new Elysia().get(
	"/product-categories",
	async ({ query }) => {
		const result = await listProductCategories(query);
		return okPage(result.data, result.pagination);
	},
	{
		query: ProductCategoryListQuery,
		response: withErrors({ 200: okPageRes(ProductCategoryWithMacroSchema) }),
		detail: {
			summary: "Lista categorie prodotto",
			description:
				"Restituisce la lista paginata delle sotto-categorie prodotto con la macro categoria di appartenenza.",
			tags: ["Product Categories"],
		},
	},
);
