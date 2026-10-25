import { Hono } from "hono";
import { doc } from "@/http/openapi";
import { publicRoute } from "@/http/routes";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { okPage } from "@/lib/responses";
import { ProductMacroCategorySchema } from "@/lib/zod/entities";
import { CategoryListQuery } from "@/lib/zod/queries";
import { okPageRes, withErrors } from "@/lib/zod/responses";
import { listProductMacroCategories } from "../services/product-macro-categories";

const ProductMacroCategoryListResponse = okPageRes(ProductMacroCategorySchema);

// Route relativa: la sub-app è montata su /product-macro-categories.
export const productMacroCategoriesRoutes = new Hono().get(
	"/",
	doc({
		response: withErrors({ 200: ProductMacroCategoryListResponse }),
		detail: {
			summary: "Lista macro categorie prodotto",
			description:
				"Restituisce la lista paginata di tutte le macro categorie prodotto.",
			tags: ["Product Macro Categories"],
		},
	}),
	publicRoute,
	v("query", CategoryListQuery),
	async (c) => {
		const result = await listProductMacroCategories(c.req.valid("query"));
		return send(
			c,
			ProductMacroCategoryListResponse,
			okPage(result.data, result.pagination),
		);
	},
);
