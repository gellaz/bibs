import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
	product,
	productClassification,
	storeProduct,
} from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { store } from "@/db/schemas/store";
import { parsePagination } from "@/lib/pagination";

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
		sql`${product.isActive} = true`,
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
        SELECT 1 FROM ${productClassification}
        WHERE ${productClassification.productId} = ${product.id}
        AND ${productClassification.productCategoryId} = ${categoryId}
      )`,
		);
	}

	// Must have stock in at least one store (+ optional geo filter)
	conditions.push(
		sql`EXISTS (
      SELECT 1 FROM ${storeProduct}
      INNER JOIN ${store} ON ${store.id} = ${storeProduct.storeId}
      WHERE ${storeProduct.productId} = ${product.id}
      AND ${storeProduct.stock} > 0
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

	const distanceExpr = hasGeo
		? sql`(
          SELECT MIN(ST_Distance(
            ${store.location}::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
          ))
          FROM ${storeProduct}
          INNER JOIN ${store} ON ${store.id} = ${storeProduct.storeId}
          WHERE ${storeProduct.productId} = ${product.id}
          AND ${storeProduct.stock} > 0
        )`
		: sql`0`;

	const rankExpr = q
		? sql`ts_rank_cd(
          setweight(to_tsvector('italian', ${product.name}), 'A') ||
          setweight(to_tsvector('italian', coalesce(${product.description}, '')), 'B'),
          websearch_to_tsquery('italian', ${q})
        )`
		: sql`0`;

	// Order by: text relevance first (desc), then distance (asc)
	const orderExpr = q ? sql`rank DESC, distance ASC` : sql`distance ASC`;

	const [data, [{ total }]] = await Promise.all([
		db
			.select({
				id: product.id,
				name: product.name,
				description: product.description,
				price: product.price,
				distance: sql<number>`${distanceExpr}`.as("distance"),
				rank: sql<number>`${rankExpr}`.as("rank"),
				images: sql<{ id: string; url: string; position: number }[]>`(
          SELECT coalesce(json_agg(json_build_object(
            'id', ${productImage.id},
            'url', ${productImage.url},
            'position', ${productImage.position}
          ) ORDER BY ${productImage.position}), '[]'::json)
          FROM ${productImage}
          WHERE ${productImage.productId} = ${product.id}
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

	return { data, pagination: { page, limit, total } };
}
