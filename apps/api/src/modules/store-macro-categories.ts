import { Elysia } from "elysia";
import { CategoryListQuery } from "@/lib/queries";
import { okPage } from "@/lib/responses";
import { okPageRes, StoreMacroCategorySchema, withErrors } from "@/lib/schemas";
import { listStoreMacroCategories } from "./admin/services/store-macro-categories";

export const storeMacroCategoriesModule = new Elysia().get(
	"/store-macro-categories",
	async ({ query }) => {
		const result = await listStoreMacroCategories(query);
		return okPage(result.data, result.pagination);
	},
	{
		query: CategoryListQuery,
		response: withErrors({ 200: okPageRes(StoreMacroCategorySchema) }),
		detail: {
			summary: "Lista macro categorie negozio",
			description:
				"Restituisce la lista paginata di tutte le macro categorie negozio.",
			tags: ["Store Macro Categories"],
		},
	},
);
