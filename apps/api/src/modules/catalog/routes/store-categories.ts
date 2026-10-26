import { Hono } from "hono";
import { z } from "zod";
import { doc } from "@/http/openapi";
import { publicRoute } from "@/http/routes";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { okPage } from "@/lib/responses";
import { StoreCategoryWithMacroSchema } from "@/lib/schemas/entities";
import { CategoryListQuery } from "@/lib/schemas/queries";
import { okPageRes, withErrors } from "@/lib/schemas/responses";
import { listStoreCategories } from "../services/store-categories";

const StoreCategoryListQuery = CategoryListQuery.extend({
	macroCategoryId: z
		.string()
		.meta({ description: "Filtra per ID della macro categoria" })
		.optional(),
});

const StoreCategoryListResponse = okPageRes(StoreCategoryWithMacroSchema);

// Route relativa: la sub-app è montata su /store-categories.
export const storeCategoriesRoutes = new Hono().get(
	"/",
	doc({
		response: withErrors({ 200: StoreCategoryListResponse }),
		detail: {
			summary: "Lista categorie negozio",
			description:
				"Restituisce la lista paginata delle categorie negozio con la macro categoria di appartenenza.",
			tags: ["Store Categories"],
		},
	}),
	publicRoute,
	v("query", StoreCategoryListQuery),
	async (c) => {
		const result = await listStoreCategories(c.req.valid("query"));
		return send(
			c,
			StoreCategoryListResponse,
			okPage(result.data, result.pagination),
		);
	},
);
