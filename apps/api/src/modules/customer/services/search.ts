import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
	product,
	productCategoryAssignment,
	storeProduct,
} from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { store } from "@/db/schemas/store";
import { parsePagination } from "@/lib/pagination";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";

interface SearchParams {
	q?: string;
	categoryId?: string;
	lat?: number;
	lng?: number;
	radius?: number;
	page?: number;
	limit?: number;
}

export async function searchProducts(params: SearchParams) {
	const { q, categoryId, lat, lng, radius = 50 } = params;
	const { page, limit, offset } = parsePagination(params);

	const conditions: ReturnType<typeof sql>[] = [
		sql`${product.status} = 'active'`,
	];

	// Full-text search (Italian)
	if (q) {
		conditions.push(
			sql`(
        setweight(to_tsvector('italian', ${product.name}), 'A') ||
        setweight(to_tsvector('italian', coalesce(${product.description}, '')), 'B')
      ) @@ websearch_to_tsquery('italian', ${q})`,
		);
	}

	// Category filter
	if (categoryId) {
		conditions.push(
			sql`EXISTS (
        SELECT 1 FROM ${productCategoryAssignment}
        WHERE ${productCategoryAssignment.productId} = ${product.id}
        AND ${productCategoryAssignment.productCategoryId} = ${categoryId}
      )`,
		);
	}

	// Must have stock in at least one active (non-deleted) store (+ optional geo filter)
	conditions.push(
		sql`EXISTS (
      SELECT 1 FROM ${storeProduct}
      INNER JOIN ${store} ON ${store.id} = ${storeProduct.storeId}
      WHERE ${storeProduct.productId} = ${product.id}
      AND ${storeProduct.stock} > 0
      AND ${store.deletedAt} IS NULL
      ${
				lat !== undefined && lng !== undefined
					? sql`AND ST_DWithin(
              ${store.location}::geography,
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${radius * 1000}
            )`
					: sql``
			}
    )`,
	);

	const whereClause = sql.join(conditions, sql` AND `);

	const hasGeo = lat !== undefined && lng !== undefined;

	// Stessa accortezza della subquery `images`: dentro un campo SELECT le
	// Column interpolate non vengono qualificate, e qui l'interna ha due tabelle
	// (store_products + stores) entrambe con `id` → "id" sarebbe ambiguo. Alias
	// espliciti (sp, s) e correlazione letterale su products.id.
	const distanceExpr = hasGeo
		? sql`(
          SELECT MIN(ST_Distance(
            s.location::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
          ))
          FROM ${storeProduct} sp
          INNER JOIN ${store} s ON s.id = sp.store_id
          WHERE sp.product_id = products.id
          AND sp.stock > 0
          AND s.deleted_at IS NULL
        )`
		: sql`0`;

	const rankExpr = q
		? sql`ts_rank_cd(
          setweight(to_tsvector('italian', ${product.name}), 'A') ||
          setweight(to_tsvector('italian', coalesce(${product.description}, '')), 'B'),
          websearch_to_tsquery('italian', ${q})
        )`
		: sql`0`;

	// Order by: text relevance first (desc), then distance (asc), with a stable
	// tiebreaker (createdAt desc, id asc) so pagination is deterministic even when
	// many rows share the same rank/distance (e.g. no-query, no-geo where distance
	// is a constant 0).
	const orderExpr = q
		? sql`rank DESC, distance ASC, ${product.createdAt} DESC, ${product.id} ASC`
		: sql`distance ASC, ${product.createdAt} DESC, ${product.id} ASC`;

	const [data, [{ total }]] = await Promise.all([
		db
			.select({
				id: product.id,
				name: product.name,
				description: product.description,
				price: product.price,
				distance: sql<number>`${distanceExpr}`.as("distance"),
				rank: sql<number>`${rankExpr}`.as("rank"),
				// NB: in un `sql` template usato come campo della SELECT, Drizzle
				// rende le Column interpolate SENZA qualificarle con la tabella
				// (es. ${product.id} → "id"). In una subquery correlata "id" verrebbe
				// risolto sulla tabella interna (product_images), spezzando la
				// correlazione (product_id = id → sempre vuoto). Quindi: alias
				// esplicito (pi) per l'interna e riferimento letterale products.id
				// per la tabella esterna.
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
			.where(whereClause)
			.orderBy(orderExpr)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(product)
			.where(whereClause),
	]);

	const productIds = data.map((r) => r.id);
	const discountMap = await getBestActiveDiscounts(productIds);
	const annotated = data.map((r) => {
		const info = discountMap.get(r.id);
		return {
			...r,
			discountedPrice: info?.discountedPrice ?? null,
			discountPercent: info?.percent ?? null,
			discountTitle: info?.title ?? null,
			discountEndsAt: info?.endsAt ?? null,
		};
	});

	return { data: annotated, pagination: { page, limit, total } };
}
