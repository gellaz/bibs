import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
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
		query: t.Object({
			q: t.Optional(
				t.String({ description: "Testo di ricerca (full-text italiano)" }),
			),
			categoryId: t.Optional(
				t.String({ description: "Filtra per ID categoria" }),
			),
			lat: t.Optional(
				t.Number({ description: "Latitudine del punto di ricerca" }),
			),
			lng: t.Optional(
				t.Number({ description: "Longitudine del punto di ricerca" }),
			),
			radius: t.Optional(
				t.Number({
					default: 50,
					description: "Raggio di ricerca in km (default: 50)",
				}),
			),
			...PaginationQuery.properties,
		}),
		response: withErrors({ 200: okPageRes(SearchResultSchema) }),
		detail: {
			summary: "Ricerca prodotti",
			description:
				"Ricerca pubblica di prodotti con full-text search in italiano e filtro geografico (PostGIS). Non richiede autenticazione.",
			tags: ["Customer - Search"],
		},
	},
);
