import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ProductDetailQuery, ProductSearchQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	CustomerProductDetailSchema,
	okPageRes,
	okRes,
	ProductCardSchema,
	ProductFacetsSchema,
	withErrors,
} from "@/lib/schemas";
import { getProductDetail } from "../services/product-detail";
import { getProductFacets } from "../services/product-facets";
import { searchProducts } from "../services/product-search";

export const productsRoutes = new Elysia()
	.get(
		"/products",
		async ({ query, store }) => {
			const pino = getLogger(store);
			const result = await searchProducts(query);

			pino.info(
				{
					searchQuery: query.q,
					categoryId: query.categoryId,
					macroCategoryId: query.macroCategoryId,
					hasGeoFilter: !!(query.lat && query.lng),
					radius: query.radius,
					openNow: query.openNow,
					onSale: query.onSale,
					resultCount: result.data.length,
					action: "product_search",
				},
				"Ricerca prodotti eseguita",
			);

			return okPage(result.data, result.pagination);
		},
		{
			query: ProductSearchQuery,
			response: withErrors({ 200: okPageRes(ProductCardSchema) }),
			detail: {
				summary: "Ricerca prodotti",
				description:
					"Ricerca pubblica di prodotti con full-text italiano e filtro geografico (PostGIS). Ogni risultato è un prodotto agganciato al negozio più vicino che lo ha disponibile fra quelli che soddisfano i filtri; `otherStoreCount` dice quanti altri ce l'hanno. Solo negozi pubblicamente visibili. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	)
	.get(
		"/products/facets",
		async ({ query, store }) => {
			const pino = getLogger(store);
			const facets = await getProductFacets(query);
			pino.info(
				{
					searchQuery: query.q,
					hasGeoFilter: !!(query.lat && query.lng),
					radius: query.radius,
					openNow: query.openNow,
					onSale: query.onSale,
					macroCount: facets.macros.length,
					action: "product_facets",
				},
				"Facet di ricerca prodotti richiesti",
			);
			return ok(facets);
		},
		{
			query: t.Omit(ProductSearchQuery, [
				"page",
				"limit",
				"categoryId",
				"macroCategoryId",
			]),
			response: withErrors({ 200: okRes(ProductFacetsSchema) }),
			detail: {
				summary: "Facet di ricerca prodotti",
				description:
					"Conteggi per macro categoria e categoria sui prodotti che corrispondono a testo, geografia, prezzo e offerta. Non applica mai la categoria già selezionata: il rail deve mostrare le alternative. Le macro senza prodotti non vengono restituite. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	)
	.get(
		"/products/:id",
		async ({ params, query, store }) => {
			const pino = getLogger(store);
			const detail = await getProductDetail(params.id, query);
			pino.info(
				{
					productId: params.id,
					requestedStoreId: query.storeId,
					attachedStoreId: detail.offer.store.id,
					hasGeo: !!(query.lat && query.lng),
					characteristicCount: detail.characteristics.length,
					action: "product_detail",
				},
				"Scheda prodotto richiesta",
			);
			return ok(detail);
		},
		{
			params: t.Object({ id: t.String({ description: "ID del prodotto" }) }),
			query: ProductDetailQuery,
			response: withErrors({ 200: okRes(CustomerProductDetailSchema) }),
			detail: {
				summary: "Scheda prodotto",
				description:
					"Scheda pubblica di un prodotto con un negozio agganciato: quello indicato da `storeId` se lo ha disponibile, altrimenti il più vicino all'origine, altrimenti il primo per nome. Include le sole caratteristiche valorizzate, con l'etichetta delle opzioni. Restituisce 404 se il prodotto non è attivo o nessun negozio visibile lo ha disponibile. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	);
