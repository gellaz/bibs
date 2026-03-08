import { Elysia } from "elysia";
import { CategoryListQuery } from "@/lib/queries";
import { okPage } from "@/lib/responses";
import { okPageRes, ProductCategorySchema, withErrors } from "@/lib/schemas";
import { listProductCategories } from "./admin/services/product-categories";

export const productCategoriesModule = new Elysia().get(
	"/product-categories",
	async ({ query }) => {
		const result = await listProductCategories(query);
		return okPage(result.data, result.pagination);
	},
	{
		query: CategoryListQuery,
		response: withErrors({ 200: okPageRes(ProductCategorySchema) }),
		detail: {
			summary: "Lista categorie prodotto",
			description:
				"Restituisce la lista paginata di tutte le categorie prodotto.",
			tags: ["Product Categories"],
		},
	},
);
