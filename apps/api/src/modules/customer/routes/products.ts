import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ProductSearchQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	okPageRes,
	okRes,
	ProductCardSchema,
	ProductFacetsSchema,
	withErrors,
} from "@/lib/schemas";
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
	);
