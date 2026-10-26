import { Hono } from "hono";
import { doc } from "@/http/openapi";
import { publicRoute } from "@/http/routes";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { okPage } from "@/lib/responses";
import { ProductCategoryWithMacroSchema } from "@/lib/schemas/entities";
import { ProductCategoryListQuery } from "@/lib/schemas/queries";
import { okPageRes, withErrors } from "@/lib/schemas/responses";
import { listProductCategories } from "../services/product-categories";

const ProductCategoryListResponse = okPageRes(ProductCategoryWithMacroSchema);

// Route relativa: la sub-app è montata su /product-categories (`src/app.ts`).
export const productCategoriesRoutes = new Hono().get(
	"/",
	doc({
		response: withErrors({ 200: ProductCategoryListResponse }),
		detail: {
			summary: "Lista categorie prodotto",
			description:
				"Restituisce la lista paginata delle sotto-categorie prodotto con la macro categoria di appartenenza.",
			tags: ["Product Categories"],
		},
	}),
	publicRoute,
	v("query", ProductCategoryListQuery),
	async (c) => {
		const result = await listProductCategories(c.req.valid("query"));
		return send(
			c,
			ProductCategoryListResponse,
			okPage(result.data, result.pagination),
		);
	},
);
