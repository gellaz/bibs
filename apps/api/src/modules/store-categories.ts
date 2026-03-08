import { Elysia } from "elysia";
import { CategoryListQuery } from "@/lib/pagination";
import { okPage } from "@/lib/responses";
import { okPageRes, StoreCategorySchema, withErrors } from "@/lib/schemas";
import { listStoreCategories } from "./admin/services/store-categories";

export const storeCategoriesModule = new Elysia().get(
	"/store-categories",
	async ({ query }) => {
		const result = await listStoreCategories(query);
		return okPage(result.data, result.pagination);
	},
	{
		query: CategoryListQuery,
		response: withErrors({ 200: okPageRes(StoreCategorySchema) }),
		detail: {
			summary: "Lista categorie negozio",
			description:
				"Restituisce la lista paginata di tutte le categorie negozio.",
			tags: ["Store Categories"],
		},
	},
);
