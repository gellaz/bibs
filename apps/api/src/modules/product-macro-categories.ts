import { Elysia } from "elysia";
import { CategoryListQuery } from "@/lib/queries";
import { okPage } from "@/lib/responses";
import {
	okPageRes,
	ProductMacroCategorySchema,
	withErrors,
} from "@/lib/schemas";
import { listProductMacroCategories } from "./admin/services/product-macro-categories";

export const productMacroCategoriesModule = new Elysia().get(
	"/product-macro-categories",
	async ({ query }) => {
		const result = await listProductMacroCategories(query);
		return okPage(result.data, result.pagination);
	},
	{
		query: CategoryListQuery,
		response: withErrors({ 200: okPageRes(ProductMacroCategorySchema) }),
		detail: {
			summary: "Lista macro categorie prodotto",
			description:
				"Restituisce la lista paginata di tutte le macro categorie prodotto.",
			tags: ["Product Macro Categories"],
		},
	},
);
