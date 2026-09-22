import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { product, storeProduct } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { store } from "@/db/schemas/store";
import { parsePagination } from "@/lib/pagination";
import { openNowCondition } from "@/lib/store-open-status";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";
import {
	distanceExpr,
	offerConditions,
	type ProductFilterParams,
	productConditions,
	searchVector,
} from "./product-search-conditions";

export interface ProductSearchParams extends ProductFilterParams {
	page?: number;
	limit?: number;
}

export interface ProductCard {
	id: string;
	name: string;
	description: string | null;
	price: string;
	/** Riga `store_products` del negozio agganciato: è ciò che il carrello vuole. */
	storeProductId: string;
	stock: number;
	store: {
		id: string;
		name: string;
		municipality: { id: string; name: string; provinceAcronym: string };
	};
	/** Metri dall'origine, `null` senza origine. */
	distance: number | null;
	/** Altri negozi che soddisfano i filtri, oltre a quello agganciato. */
	otherStoreCount: number;
	rank: number;
	images: { id: string; url: string; position: number }[];
	discountedPrice: string | null;
	discountPercent: number | null;
}

/**
 * Il laterale sceglie UN negozio per prodotto.
 *
 * Con un'origine vince il più vicino; senza, `distance` è `NULL` per tutte le
 * righe e `ORDER BY distance NULLS LAST, nome` degrada da solo sull'ordine per
 * nome — la regola "senza posizione il primo per nome" non è un ramo, è la
 * stessa clausola.
 *
 * `count(*) OVER ()` conta tutte le righe che passano il `WHERE`: le window si
 * valutano prima di `ORDER BY` e `LIMIT`, quindi il conteggio degli altri
 * negozi non costa una seconda query.
 *
 * Costruito col query builder di proposito: le condizioni finiscono in un
 * `.where()` vero, dove Drizzle qualifica le Column, e `publiclyVisibleStore()`
 * e `openNowCondition()` si riusano senza toccarli.
 *
 * Ogni campo qui è alias-ato esplicitamente: Drizzle non rinomina una Column
 * grezza nella SQL generata sulla base della chiave dell'oggetto `.select()`,
 * quindi senza `.as()` la sub-select produrrebbe tre colonne fisiche chiamate
 * `id` (`store_products.id`, `stores.id`, `municipalities.id`) e due chiamate
 * `name` (`stores.name`, `municipalities.name`) — legale come derived table,
 * ma poi `"offer"."id"` nella query esterna è ambiguo fra le tre. Verificato
 * live: senza alias, Postgres rifiuta con `column reference "id" is ambiguous`.
 */
function buildOffer(
	params: ProductSearchParams,
	openCondition: ReturnType<typeof sql> | null,
) {
	return db
		.select({
			storeProductId: sql<string>`${storeProduct.id}`.as("store_product_id"),
			stock: sql<number>`${storeProduct.stock}`.as("stock"),
			storeId: sql<string>`${store.id}`.as("store_id"),
			storeName: sql<string>`${store.name}`.as("store_name"),
			municipalityId: sql<string>`${municipality.id}`.as("municipality_id"),
			municipalityName: sql<string>`${municipality.name}`.as(
				"municipality_name",
			),
			provinceAcronym: sql<string>`${province.acronym}`.as("province_acronym"),
			distance: sql<number | null>`${distanceExpr(params.lat, params.lng)}`.as(
				"distance",
			),
			matchCount: sql<number>`(count(*) OVER ())::int`.as("match_count"),
		})
		.from(storeProduct)
		.innerJoin(store, eq(store.id, storeProduct.storeId))
		.innerJoin(municipality, eq(municipality.id, store.municipalityId))
		.innerJoin(province, eq(province.id, municipality.provinceId))
		.where(sql.join(offerConditions(params, openCondition), sql` AND `))
		.orderBy(sql`distance ASC NULLS LAST, ${store.name} ASC, ${store.id} ASC`)
		.limit(1)
		.as("offer");
}

export async function searchProducts(params: ProductSearchParams) {
	const { page, limit, offset } = parsePagination(params);

	// `openNow` restringe anche l'aggancio, non solo l'insieme: entra fra le
	// condizioni del laterale, quindi il negozio scelto è il più vicino APERTO.
	// La condizione si costruisce una volta sola: legge le festività attive.
	const openCondition = params.openNow
		? await openNowCondition(new Date())
		: null;
	const whereClause = sql.join(productConditions(params), sql` AND `);

	const rankExpr = params.q
		? sql`ts_rank_cd(${searchVector()}, websearch_to_tsquery('italian', ${params.q}))`
		: sql`0`;

	// Rilevanza → distanza → tiebreaker stabile: senza l'ultimo la paginazione
	// non è deterministica quando molte righe pareggiano (es. nessuna query e
	// nessuna origine, dove rank e distance sono costanti).
	// `"offer"."distance"` alla lettera: in ORDER BY `distance` da solo
	// pescherebbe l'alias di output, che qui è la stessa cosa ma non ovunque.
	const orderExpr = params.q
		? sql`rank DESC, "offer"."distance" ASC NULLS LAST, ${product.createdAt} DESC, ${product.id} ASC`
		: sql`"offer"."distance" ASC NULLS LAST, ${product.createdAt} DESC, ${product.id} ASC`;

	const offer = buildOffer(params, openCondition);
	const offerForCount = buildOffer(params, openCondition);

	const [rows, [{ total }]] = await Promise.all([
		db
			.select({
				id: product.id,
				name: product.name,
				description: product.description,
				price: product.price,
				storeProductId: offer.storeProductId,
				stock: offer.stock,
				storeId: offer.storeId,
				storeName: offer.storeName,
				municipalityId: offer.municipalityId,
				municipalityName: offer.municipalityName,
				provinceAcronym: offer.provinceAcronym,
				distance: offer.distance,
				matchCount: offer.matchCount,
				rank: sql<number>`${rankExpr}`.as("rank"),
				// Alias esplicito `pi` per l'interna e riferimento letterale
				// `products.id` per l'esterna: in un campo della SELECT le Column
				// interpolate perdono la qualificazione, e `id` verrebbe risolto su
				// product_images spezzando la correlazione.
				images: sql<{ id: string; url: string; position: number }[]>`(
					SELECT coalesce(json_agg(json_build_object(
						'id', pi.id,
						'url', pi.url,
						'position', pi.position
					) ORDER BY pi.position), '[]'::json)
					FROM ${productImage} pi
					WHERE pi.product_id = products.id
				)`.as("images"),
			})
			.from(product)
			.innerJoinLateral(offer, sql`true`)
			.where(whereClause)
			.orderBy(orderExpr)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(product)
			.innerJoinLateral(offerForCount, sql`true`)
			.where(whereClause),
	]);

	const discountMap = await getBestActiveDiscounts(rows.map((r) => r.id));

	const data: ProductCard[] = rows.map((r) => {
		const info = discountMap.get(r.id);
		return {
			id: r.id,
			name: r.name,
			description: r.description,
			price: r.price,
			storeProductId: r.storeProductId,
			stock: r.stock,
			store: {
				id: r.storeId,
				name: r.storeName,
				municipality: {
					id: r.municipalityId,
					name: r.municipalityName,
					provinceAcronym: r.provinceAcronym,
				},
			},
			distance: r.distance,
			otherStoreCount: r.matchCount - 1,
			rank: r.rank,
			images: r.images,
			discountedPrice: info?.discountedPrice ?? null,
			discountPercent: info?.percent ?? null,
		};
	});

	return { data, pagination: { page, limit, total } };
}
