import { Hono } from "hono";
import { z } from "zod";
import { doc } from "@/http/openapi";
import { ok, okPage } from "@/http/responses";
import { publicRoute } from "@/http/routes";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { StoreFacetsSchema } from "@/schemas/composed";
import {
	StoreCardSchema,
	StoreDetailSchema,
	StoreMapSchema,
	StoreProductCardSchema,
} from "@/schemas/entities";
import { PaginationQuery } from "@/schemas/pagination";
import { StoreSearchQuery } from "@/schemas/queries";
import { okPageRes, okRes, withErrors } from "@/schemas/responses";
import { getStoreDetail } from "../services/store-detail";
import { searchStores } from "../services/store-discovery";
import { getStoreFacets } from "../services/store-facets";
import { getStoreMapPins } from "../services/store-map";
import { getStoreProducts } from "../services/store-products";

const StorePage = okPageRes(StoreCardSchema);
const FacetsResponse = okRes(StoreFacetsSchema);
const MapResponse = okRes(StoreMapSchema);
const DetailResponse = okRes(StoreDetailSchema);
const ProductPage = okPageRes(StoreProductCardSchema);
const StoreParams = z.object({
	id: z.string().meta({ description: "ID del negozio" }),
});

// Route relative e pubbliche: il modulo è montato su /customer (`src/app.ts`).
export const storesRoutes = new Hono()
	.get(
		"/stores",
		doc({
			response: withErrors({ 200: StorePage }),
			detail: {
				summary: "Ricerca negozi",
				description:
					"Ricerca pubblica di negozi per vicinanza (PostGIS) con ricerca testuale opzionale su nome e comune. Senza testo restituisce tutti i negozi visibili. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		}),
		publicRoute,
		v("query", StoreSearchQuery),
		async (c) => {
			const query = c.req.valid("query");
			const result = await searchStores(query);
			logger.info(
				{
					searchQuery: query.q,
					categoryId: query.categoryId,
					macroCategoryId: query.macroCategoryId,
					hasGeoFilter: query.lat !== undefined && query.lng !== undefined,
					radius: query.radius,
					openNow: query.openNow,
					resultCount: result.data.length,
					action: "store_search",
				},
				"Ricerca negozi eseguita",
			);
			return send(c, StorePage, okPage(result.data, result.pagination));
		},
	)
	.get(
		"/stores/facets",
		doc({
			response: withErrors({ 200: FacetsResponse }),
			detail: {
				summary: "Facet di ricerca negozi",
				description:
					"Conteggi per macro categoria e categoria sui negozi che corrispondono a testo e raggio. Le categorie senza negozi non vengono restituite. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		}),
		publicRoute,
		v(
			"query",
			StoreSearchQuery.omit({
				page: true,
				limit: true,
				categoryId: true,
				macroCategoryId: true,
			}),
		),
		async (c) => {
			const query = c.req.valid("query");
			const facets = await getStoreFacets(query);
			logger.info(
				{
					searchQuery: query.q,
					hasGeoFilter: query.lat !== undefined && query.lng !== undefined,
					radius: query.radius,
					openNow: query.openNow,
					macroCount: facets.macros.length,
					action: "store_facets",
				},
				"Facet di ricerca negozi richiesti",
			);
			return send(c, FacetsResponse, ok(facets));
		},
	)
	.get(
		"/stores/map",
		doc({
			response: withErrors({ 200: MapResponse }),
			detail: {
				summary: "Pin mappa negozi",
				description:
					"Tutti i negozi che corrispondono ai filtri, con le coordinate, per la vista mappa. Non paginato: una mappa non si scorre a pagine. Restituisce al massimo 500 pin (`truncated: true` oltre quella soglia) ordinati per distanza quando `lat`/`lng` sono presenti, altrimenti per nome. `total` conta anche i negozi senza posizione, che non compaiono fra i pin; `mappable` è quanti di quei `total` hanno effettivamente una posizione e possono quindi comparire fra i pin (`pins.length` = `min(mappable, 500)`). Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		}),
		publicRoute,
		v("query", StoreSearchQuery.omit({ page: true, limit: true })),
		async (c) => {
			const query = c.req.valid("query");
			const result = await getStoreMapPins(query);
			logger.info(
				{
					searchQuery: query.q,
					categoryId: query.categoryId,
					macroCategoryId: query.macroCategoryId,
					hasGeoFilter: query.lat !== undefined && query.lng !== undefined,
					radius: query.radius,
					openNow: query.openNow,
					pinCount: result.pins.length,
					total: result.total,
					truncated: result.truncated,
					action: "store_map",
				},
				"Pin mappa negozi richiesti",
			);
			return send(c, MapResponse, ok(result));
		},
	)
	.get(
		"/stores/:id",
		doc({
			response: withErrors({ 200: DetailResponse }),
			detail: {
				summary: "Dettaglio negozio",
				description:
					"Scheda pubblica di un negozio visibile. Restituisce 404 se il negozio non esiste o non è pubblicamente visibile (sospeso/cancellato/senza abbonamento). Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		}),
		publicRoute,
		v("param", StoreParams),
		async (c) => {
			const { id } = c.req.valid("param");
			const detail = await getStoreDetail(id);
			logger.info(
				{ storeId: id, action: "store_detail" },
				"Dettaglio negozio richiesto",
			);
			return send(c, DetailResponse, ok(detail));
		},
	)
	.get(
		"/stores/:id/products",
		doc({
			response: withErrors({ 200: ProductPage }),
			detail: {
				summary: "Catalogo prodotti del negozio",
				description:
					"Prodotti attivi e disponibili (stock > 0) di un negozio pubblicamente visibile, ordinati per novità. Restituisce 404 se il negozio non esiste o non è visibile (sospeso/cancellato/senza abbonamento). Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		}),
		publicRoute,
		v("param", StoreParams),
		v("query", PaginationQuery),
		async (c) => {
			const { id } = c.req.valid("param");
			const result = await getStoreProducts(id, c.req.valid("query"));
			logger.info(
				{
					storeId: id,
					resultCount: result.data.length,
					action: "store_products",
				},
				"Catalogo negozio richiesto",
			);
			return send(c, ProductPage, okPage(result.data, result.pagination));
		},
	);
