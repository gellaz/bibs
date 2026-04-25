import { Elysia } from "elysia";
import { getLogger } from "@/lib/logger";
import { ProductSearchQuery } from "@/lib/queries";
import { okPage } from "@/lib/responses";
import { okPageRes, SearchResultSchema, withErrors } from "@/lib/schemas";
import { searchProducts } from "../services/search";

export const searchRoutes = new Elysia().get(
	"/search",
	async ({ query, store }) => {
		const pino = getLogger(store);
		const result = await searchProducts(query);

		pino.info(
			{
				searchQuery: query.q,
				categoryId: query.categoryId,
				hasGeoFilter: !!(query.lat && query.lng),
				resultCount: result.data.length,
				action: "product_search",
			},
			"Ricerca prodotti eseguita",
		);

		return okPage(result.data, result.pagination);
	},
	{
		query: ProductSearchQuery,
		response: withErrors({ 200: okPageRes(SearchResultSchema) }),
		detail: {
			summary: "Ricerca prodotti",
			description:
				"Ricerca pubblica di prodotti con full-text search in italiano e filtro geografico (PostGIS). Non richiede autenticazione.",
			tags: ["Customer - Search"],
		},
	},
);
