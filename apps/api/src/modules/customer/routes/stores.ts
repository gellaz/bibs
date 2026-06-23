import { Elysia } from "elysia";
import { getLogger } from "@/lib/logger";
import { StoreSearchQuery } from "@/lib/queries";
import { okPage } from "@/lib/responses";
import { okPageRes, StoreCardSchema, withErrors } from "@/lib/schemas";
import { searchStores } from "../services/store-discovery";

export const storesRoutes = new Elysia().get(
	"/stores",
	async ({ query, store }) => {
		const pino = getLogger(store);
		const result = await searchStores(query);

		pino.info(
			{
				searchQuery: query.q,
				categoryId: query.categoryId,
				hasGeoFilter: !!(query.lat && query.lng),
				resultCount: result.data.length,
				action: "store_search",
			},
			"Ricerca negozi eseguita",
		);

		return okPage(result.data, result.pagination);
	},
	{
		query: StoreSearchQuery,
		response: withErrors({ 200: okPageRes(StoreCardSchema) }),
		detail: {
			summary: "Ricerca negozi",
			description:
				"Ricerca pubblica di negozi per vicinanza (PostGIS) con ricerca testuale opzionale su nome e comune. Senza testo restituisce tutti i negozi visibili. Non richiede autenticazione.",
			tags: ["Customer - Search"],
		},
	},
);
