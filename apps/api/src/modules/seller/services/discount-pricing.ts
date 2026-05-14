import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface ActiveDiscountInfo {
	discountId: string;
	title: string;
	percent: number;
	endsAt: Date | null;
	originalPrice: string;
	discountedPrice: string;
}

/**
 * Returns the best (highest percent) active discount applied to a product,
 * or null if none exists.
 *
 * An "active" discount: status='active', startsAt<=now, endsAt IS NULL OR endsAt>=now,
 * and belongs to the same seller as the product.
 */
export async function getBestActiveDiscount(
	productId: string,
): Promise<ActiveDiscountInfo | null> {
	const result = await db.execute<{
		discount_id: string;
		title: string;
		percent: number;
		ends_at: Date | null;
		original_price: string;
		discounted_price: string;
	}>(sql`
		SELECT d.id AS discount_id,
		       d.title,
		       d.percent,
		       d.ends_at,
		       p.price AS original_price,
		       ROUND(p.price * (1 - d.percent::numeric / 100), 2)::text AS discounted_price
		FROM products p
		JOIN discount_products dp ON dp.product_id = p.id
		JOIN discounts d ON d.id = dp.discount_id
		WHERE p.id = ${productId}
		  AND d.seller_profile_id = p.seller_profile_id
		  AND d.status = 'active'
		  AND d.starts_at <= now()
		  AND (d.ends_at IS NULL OR d.ends_at >= now())
		ORDER BY d.percent DESC, d.starts_at DESC
		LIMIT 1
	`);

	const row = (result as unknown as { rows: any[] }).rows[0];
	if (!row) return null;

	return {
		discountId: row.discount_id,
		title: row.title,
		percent: row.percent,
		endsAt: row.ends_at,
		originalPrice: row.original_price,
		discountedPrice: row.discounted_price,
	};
}

/**
 * Batch version: returns a Map<productId, ActiveDiscountInfo> for the given product IDs.
 * Used by list/search endpoints to annotate many products in one query.
 */
export async function getBestActiveDiscounts(
	productIds: string[],
): Promise<Map<string, ActiveDiscountInfo>> {
	if (productIds.length === 0) return new Map();

	const result = await db.execute<{
		product_id: string;
		discount_id: string;
		title: string;
		percent: number;
		ends_at: Date | null;
		original_price: string;
		discounted_price: string;
	}>(sql`
		SELECT DISTINCT ON (p.id)
		       p.id AS product_id,
		       d.id AS discount_id,
		       d.title,
		       d.percent,
		       d.ends_at,
		       p.price AS original_price,
		       ROUND(p.price * (1 - d.percent::numeric / 100), 2)::text AS discounted_price
		FROM products p
		JOIN discount_products dp ON dp.product_id = p.id
		JOIN discounts d ON d.id = dp.discount_id
		WHERE p.id IN (${sql.join(
			productIds.map((id) => sql`${id}`),
			sql`, `,
		)})
		  AND d.seller_profile_id = p.seller_profile_id
		  AND d.status = 'active'
		  AND d.starts_at <= now()
		  AND (d.ends_at IS NULL OR d.ends_at >= now())
		ORDER BY p.id, d.percent DESC, d.starts_at DESC
	`);

	const rows = (result as unknown as { rows: any[] }).rows;
	const map = new Map<string, ActiveDiscountInfo>();
	for (const row of rows) {
		map.set(row.product_id, {
			discountId: row.discount_id,
			title: row.title,
			percent: row.percent,
			endsAt: row.ends_at,
			originalPrice: row.original_price,
			discountedPrice: row.discounted_price,
		});
	}
	return map;
}
