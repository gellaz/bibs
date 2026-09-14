import { Elysia, t } from "elysia";
import { CategoryListQuery } from "@/lib/queries";
import { okPage } from "@/lib/responses";
import {
	okPageRes,
	StoreCategoryWithMacroSchema,
	withErrors,
} from "@/lib/schemas";
import { listStoreCategories } from "./admin/services/store-categories";

const StoreCategoryListQuery = t.Composite([
	CategoryListQuery,
	t.Object({
		macroCategoryId: t.Optional(
			t.String({ description: "Filtra per ID della macro categoria" }),
		),
	}),
]);

export const storeCategoriesModule = new Elysia().get(
	"/store-categories",
	async ({ query }) => {
		const result = await listStoreCategories(query);
		return okPage(result.data, result.pagination);
	},
	{
		query: StoreCategoryListQuery,
		response: withErrors({ 200: okPageRes(StoreCategoryWithMacroSchema) }),
		detail: {
			summary: "Lista categorie negozio",
			description:
				"Restituisce la lista paginata delle categorie negozio con la macro categoria di appartenenza.",
			tags: ["Store Categories"],
		},
	},
);
