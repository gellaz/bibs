import { Hono } from "hono";
import { doc } from "@/http/openapi";
import { publicRoute } from "@/http/routes";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { okPage } from "@/lib/responses";
import { StoreMacroCategorySchema } from "@/lib/schemas/entities";
import { CategoryListQuery } from "@/lib/schemas/queries";
import { okPageRes, withErrors } from "@/lib/schemas/responses";
import { listStoreMacroCategories } from "../services/store-macro-categories";

const StoreMacroCategoryListResponse = okPageRes(StoreMacroCategorySchema);

// Route relativa: la sub-app è montata su /store-macro-categories.
export const storeMacroCategoriesRoutes = new Hono().get(
	"/",
	doc({
		response: withErrors({ 200: StoreMacroCategoryListResponse }),
		detail: {
			summary: "Lista macro categorie negozio",
			description:
				"Restituisce la lista paginata di tutte le macro categorie negozio.",
			tags: ["Store Macro Categories"],
		},
	}),
	publicRoute,
	v("query", CategoryListQuery),
	async (c) => {
		const result = await listStoreMacroCategories(c.req.valid("query"));
		return send(
			c,
			StoreMacroCategoryListResponse,
			okPage(result.data, result.pagination),
		);
	},
);
