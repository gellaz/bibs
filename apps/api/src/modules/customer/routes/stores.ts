import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { StoreSearchQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	okPageRes,
	okRes,
	StoreCardSchema,
	StoreDetailSchema,
	StoreFacetsSchema,
	StoreProductCardSchema,
	withErrors,
} from "@/lib/schemas";
import { getStoreDetail } from "../services/store-detail";
import { searchStores } from "../services/store-discovery";
import { getStoreFacets } from "../services/store-facets";
import { getStoreProducts } from "../services/store-products";

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
					macroCategoryId: query.macroCategoryId,
					hasGeoFilter: !!(query.lat && query.lng),
					radius: query.radius,
					openNow: query.openNow,
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
		"/stores/facets",
		async ({ query, store }) => {
			const pino = getLogger(store);
			const facets = await getStoreFacets(query);
			pino.info(
				{
					searchQuery: query.q,
					hasGeoFilter: !!(query.lat && query.lng),
					radius: query.radius,
					openNow: query.openNow,
					macroCount: facets.macros.length,
					action: "store_facets",
				},
				"Facet di ricerca negozi richiesti",
			);
			return ok(facets);
		},
		{
			query: t.Omit(StoreSearchQuery, [
				"page",
				"limit",
				"categoryId",
				"macroCategoryId",
			]),
			response: withErrors({ 200: okRes(StoreFacetsSchema) }),
			detail: {
				summary: "Facet di ricerca negozi",
				description:
					"Conteggi per macro categoria e categoria sui negozi che corrispondono a testo e raggio. Le categorie senza negozi non vengono restituite. Non richiede autenticazione.",
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
	)
	.get(
		"/stores/:id/products",
		async ({ params, query, store }) => {
			const pino = getLogger(store);
			const result = await getStoreProducts(params.id, query);
			pino.info(
				{
					storeId: params.id,
					resultCount: result.data.length,
					action: "store_products",
				},
				"Catalogo negozio richiesto",
			);
			return okPage(result.data, result.pagination);
		},
		{
			params: t.Object({ id: t.String({ description: "ID del negozio" }) }),
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(StoreProductCardSchema) }),
			detail: {
				summary: "Catalogo prodotti del negozio",
				description:
					"Prodotti attivi e disponibili (stock > 0) di un negozio pubblicamente visibile, ordinati per novità. Restituisce 404 se il negozio non esiste o non è visibile (sospeso/cancellato/senza abbonamento). Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	);
