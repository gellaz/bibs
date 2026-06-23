import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { StoreSearchQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	okPageRes,
	okRes,
	StoreCardSchema,
	StoreDetailSchema,
	withErrors,
} from "@/lib/schemas";
import { getStoreDetail } from "../services/store-detail";
import { searchStores } from "../services/store-discovery";

export const storesRoutes = new Elysia()
	.get(
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
	)
	.get(
		"/stores/:id",
		async ({ params, store }) => {
			const pino = getLogger(store);
			const detail = await getStoreDetail(params.id);
			pino.info(
				{ storeId: params.id, action: "store_detail" },
				"Dettaglio negozio richiesto",
			);
			return ok(detail);
		},
		{
			params: t.Object({ id: t.String({ description: "ID del negozio" }) }),
			response: withErrors({ 200: okRes(StoreDetailSchema) }),
			detail: {
				summary: "Dettaglio negozio",
				description:
					"Scheda pubblica di un negozio visibile. Restituisce 404 se il negozio non esiste o non è pubblicamente visibile (sospeso/cancellato/senza abbonamento). Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	);
