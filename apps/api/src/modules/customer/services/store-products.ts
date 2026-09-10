import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { product, storeProduct } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";

export interface StoreProductCard {
	id: string;
	storeProductId: string;
	stock: number;
	name: string;
	description: string | null;
	price: string;
	images: { id: string; url: string; position: number }[];
	discountedPrice: string | null;
	discountPercent: number | null;
}

export async function getStoreProducts(
	storeId: string,
	params: { page?: number; limit?: number },
) {
	const { page, limit, offset } = parsePagination(params);

	// Visibility guard, distinct from "empty catalog": a hidden store is 404,
	// a visible store with no products is a 200 with an empty page. The two
	// cases cannot collapse into one query, hence this separate check.
	const [visible] = await db
		.select({ id: store.id })
		.from(store)
		.where(and(eq(store.id, storeId), publiclyVisibleStore()))
		.limit(1);
	if (!visible) throw new ServiceError(404, "Negozio non trovato");

	// La disponibilità in QUESTO negozio era un EXISTS: ora è una join, perché
	// serve far uscire store_products.id (l'identificatore che l'ordine pretende).
	// La cardinalità non cambia: store_product_product_store_idx è unique su
	// (product_id, store_id), quindi al massimo una riga per prodotto.
	const storeProductJoin = and(
		eq(storeProduct.productId, product.id),
		eq(storeProduct.storeId, storeId),
	);

	const whereClause = sql`
		${product.status} = 'active'
		AND ${storeProduct.stock} > 0
	`;

	const [data, [{ total }]] = await Promise.all([
		db
			.select({
				id: product.id,
				storeProductId: storeProduct.id,
				stock: storeProduct.stock,
				name: product.name,
				description: product.description,
				price: product.price,
				// Subquery correlata: alias l'interna (pi) e riferisci l'esterna
				// letteralmente (products.id) — le Column interpolate in un campo
				// SELECT vengono rese senza qualificazione e romperebbero la
				// correlazione.
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
			.innerJoin(storeProduct, storeProductJoin)
			.where(whereClause)
			.orderBy(sql`${product.createdAt} DESC, ${product.id} ASC`)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(product)
			.innerJoin(storeProduct, storeProductJoin)
			.where(whereClause),
	]);

	const productIds = data.map((r) => r.id);
	const discountMap = await getBestActiveDiscounts(productIds);
	const annotated: StoreProductCard[] = data.map((r) => {
		const info = discountMap.get(r.id);
		return {
			id: r.id,
			storeProductId: r.storeProductId,
			stock: r.stock,
			name: r.name,
			description: r.description,
			price: r.price,
			images: r.images,
			discountedPrice: info?.discountedPrice ?? null,
			discountPercent: info?.percent ?? null,
		};
	});

	return { data: annotated, pagination: { page, limit, total } };
}
