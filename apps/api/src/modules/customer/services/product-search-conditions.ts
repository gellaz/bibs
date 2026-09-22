import { sql } from "drizzle-orm";
import { productCategory } from "@/db/schemas/category";
import {
	product,
	productCategoryAssignment,
	storeProduct,
} from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import {
	bestActiveDiscountPercent,
	effectivePriceExpr,
} from "@/modules/seller/services/discount-pricing";

export interface ProductFilterParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	lat?: number;
	lng?: number;
	/** Raggio in km. Applicato solo se ci sono anche lat/lng. */
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
}

/** Il vettore full-text pesato: nome in A, descrizione in B. Deve restare identico all'indice GIN `product_search_idx`, o l'indice non viene usato. */
export function searchVector() {
	return sql`(
		setweight(to_tsvector('italian', ${product.name}), 'A') ||
		setweight(to_tsvector('italian', coalesce(${product.description}, '')), 'B')
	)`;
}

/** Distanza in metri dall'origine, o NULL quando non c'è un'origine. Riferimento letterale a `stores.location`: è un campo della SELECT. */
export function distanceExpr(lat?: number, lng?: number) {
	if (lat === undefined || lng === undefined)
		return sql`NULL::double precision`;
	return sql`ST_Distance(
		stores.location::geography,
		ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
	)`;
}

/**
 * Condizioni sul prodotto, per il `WHERE` esterno. Ricerca e facet rispondono
 * alla stessa domanda, quindi una copia sola.
 */
export function productConditions(
	p: ProductFilterParams,
): ReturnType<typeof sql>[] {
	const conditions = [sql`${product.status} = 'active'`];

	if (p.q) {
		conditions.push(
			sql`${searchVector()} @@ websearch_to_tsquery('italian', ${p.q})`,
		);
	}

	// `categoryId` vince su `macroCategoryId`: la foglia sta già dentro la sua
	// macro, applicarli entrambi restringerebbe allo stesso insieme.
	if (p.categoryId) {
		conditions.push(sql`EXISTS (
			SELECT 1 FROM ${productCategoryAssignment} pca
			WHERE pca.product_id = products.id
				AND pca.product_category_id = ${p.categoryId}
		)`);
	} else if (p.macroCategoryId) {
		conditions.push(sql`EXISTS (
			SELECT 1 FROM ${productCategoryAssignment} pca
			JOIN ${productCategory} pc ON pc.id = pca.product_category_id
			WHERE pca.product_id = products.id
				AND pc.macro_category_id = ${p.macroCategoryId}
		)`);
	}

	// Nel WHERE e non come post-filtro: filtrare dopo la query darebbe un
	// `total` e una paginazione che non corrispondono ai risultati.
	if (p.onSale) {
		conditions.push(sql`${bestActiveDiscountPercent()} IS NOT NULL`);
	}
	// Sul prezzo che si paga, non sul listino.
	if (p.minPrice !== undefined) {
		conditions.push(sql`${effectivePriceExpr()} >= ${p.minPrice}`);
	}
	if (p.maxPrice !== undefined) {
		conditions.push(sql`${effectivePriceExpr()} <= ${p.maxPrice}`);
	}

	return conditions;
}

/**
 * Condizioni dentro il laterale: quali negozi possono essere agganciati a un
 * prodotto. Finiscono in un `.where()` vero, quindi le Column si qualificano e
 * i predicati condivisi si riusano tali e quali.
 *
 * `openCondition` arriva dal chiamante invece di essere costruito qui, perché
 * `openNowCondition()` è asincrona (legge le festività attive) e i facet hanno
 * bisogno di comporla in due modi diversi nella stessa richiesta.
 */
export function offerConditions(
	p: ProductFilterParams,
	openCondition: ReturnType<typeof sql> | null,
): ReturnType<typeof sql>[] {
	const conditions = [
		sql`${storeProduct.productId} = products.id`,
		sql`${storeProduct.stock} > 0`,
		publiclyVisibleStore(),
	];

	if (p.lat !== undefined && p.lng !== undefined && p.radius !== undefined) {
		conditions.push(sql`ST_DWithin(
			${store.location}::geography,
			ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography,
			${p.radius * 1000}
		)`);
	}
	if (openCondition) conditions.push(openCondition);

	return conditions;
}
