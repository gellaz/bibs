import { Elysia } from "elysia";
import { CategoryListQuery } from "@/lib/pagination";
import { okPage } from "@/lib/responses";
import { CategorySchema, okPageRes, withErrors } from "@/lib/schemas";
import { listCategories } from "./admin/services/categories";

export const categoriesModule = new Elysia().get(
	"/categories",
	async ({ query }) => {
		const result = await listCategories(query);
		return okPage(result.data, result.pagination);
	},
	{
		query: CategoryListQuery,
		response: withErrors({ 200: okPageRes(CategorySchema) }),
		detail: {
			summary: "Lista categorie prodotto",
			description:
				"Restituisce la lista paginata di tutte le categorie prodotto.",
			tags: ["Categories"],
		},
	},
);
