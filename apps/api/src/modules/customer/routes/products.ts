import { Hono } from "hono";
import { z } from "zod";
import { doc } from "@/http/openapi";
import { publicRoute } from "@/http/routes";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok, okPage } from "@/lib/responses";
import {
	CustomerProductDetailSchema,
	ProductCardSchema,
	ProductFacetsSchema,
} from "@/lib/schemas/entities";
import { ProductDetailQuery, ProductSearchQuery } from "@/lib/schemas/queries";
import { okPageRes, okRes, withErrors } from "@/lib/schemas/responses";
import { getProductDetail } from "../services/product-detail";
import { getProductFacets } from "../services/product-facets";
import { searchProducts } from "../services/product-search";

const ProductPage = okPageRes(ProductCardSchema);
const FacetsResponse = okRes(ProductFacetsSchema);
const DetailResponse = okRes(CustomerProductDetailSchema);

// Route relative e pubbliche: il modulo è montato su /customer (`src/app.ts`).
export const productsRoutes = new Hono()
	.get(
		"/products",
		doc({
			response: withErrors({ 200: ProductPage }),
			detail: {
				summary: "Ricerca prodotti",
				description:
					"Ricerca pubblica di prodotti con full-text italiano e filtro geografico (PostGIS). Ogni risultato è un prodotto agganciato al negozio più vicino che lo ha disponibile fra quelli che soddisfano i filtri; `otherStoreCount` dice quanti altri ce l'hanno. Solo negozi pubblicamente visibili. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		}),
		publicRoute,
		v("query", ProductSearchQuery),
		async (c) => {
			const query = c.req.valid("query");
			const result = await searchProducts(query);

			logger.info(
				{
					searchQuery: query.q,
					categoryId: query.categoryId,
					macroCategoryId: query.macroCategoryId,
					hasGeoFilter: query.lat !== undefined && query.lng !== undefined,
					radius: query.radius,
					openNow: query.openNow,
					onSale: query.onSale,
					resultCount: result.data.length,
					action: "product_search",
				},
				"Ricerca prodotti eseguita",
			);

			return send(c, ProductPage, okPage(result.data, result.pagination));
		},
	)
	.get(
		"/products/facets",
		doc({
			response: withErrors({ 200: FacetsResponse }),
			detail: {
				summary: "Facet di ricerca prodotti",
				description:
					"Conteggi per macro categoria e categoria sui prodotti che corrispondono a testo, geografia, prezzo e offerta. Non applica mai la categoria già selezionata: il rail deve mostrare le alternative. Le macro senza prodotti non vengono restituite. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		}),
		publicRoute,
		v(
			"query",
			ProductSearchQuery.omit({
				page: true,
				limit: true,
				categoryId: true,
				macroCategoryId: true,
			}),
		),
		async (c) => {
			const query = c.req.valid("query");
			const facets = await getProductFacets(query);
			logger.info(
				{
					searchQuery: query.q,
					hasGeoFilter: query.lat !== undefined && query.lng !== undefined,
					radius: query.radius,
					openNow: query.openNow,
					onSale: query.onSale,
					macroCount: facets.macros.length,
					action: "product_facets",
				},
				"Facet di ricerca prodotti richiesti",
			);
			return send(c, FacetsResponse, ok(facets));
		},
	)
	.get(
		"/products/:id",
		doc({
			response: withErrors({ 200: DetailResponse }),
			detail: {
				summary: "Scheda prodotto",
				description:
					"Scheda pubblica di un prodotto con un negozio agganciato: quello indicato da `storeId` se lo ha disponibile, altrimenti il più vicino all'origine, altrimenti il primo per nome. Include le sole caratteristiche valorizzate, con l'etichetta delle opzioni. Restituisce 404 se il prodotto non è attivo o nessun negozio visibile lo ha disponibile. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		}),
		publicRoute,
		v(
			"param",
			z.object({ id: z.string().meta({ description: "ID del prodotto" }) }),
		),
		v("query", ProductDetailQuery),
		async (c) => {
			const { id } = c.req.valid("param");
			const query = c.req.valid("query");
			const detail = await getProductDetail(id, query);
			logger.info(
				{
					productId: id,
					requestedStoreId: query.storeId,
					attachedStoreId: detail.offer.store.id,
					hasGeo: query.lat !== undefined && query.lng !== undefined,
					characteristicCount: detail.characteristics.length,
					action: "product_detail",
				},
				"Scheda prodotto richiesta",
			);
			return send(c, DetailResponse, ok(detail));
		},
	);
