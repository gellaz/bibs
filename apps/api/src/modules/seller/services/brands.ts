import { and, count, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { brand } from "@/db/schemas/brand";
import { parsePagination } from "@/lib/pagination";

interface ListBrandsParams {
	sellerProfileId: string;
	q?: string;
	page?: number;
	limit?: number;
}

export async function listBrands(params: ListBrandsParams) {
	const { sellerProfileId, q } = params;
	const { page, limit, offset } = parsePagination(params);

	const where = q
		? and(
				eq(brand.sellerProfileId, sellerProfileId),
				ilike(brand.name, `%${q}%`),
			)
		: eq(brand.sellerProfileId, sellerProfileId);

	const [data, [{ total }]] = await Promise.all([
		db.query.brand.findMany({
			where,
			orderBy: (b, { asc }) => [asc(b.name)],
			limit,
			offset,
		}),
		db.select({ total: count() }).from(brand).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

interface FindOrCreateBrandParams {
	sellerProfileId: string;
	name: string;
}

export async function findOrCreateBrandByName(params: FindOrCreateBrandParams) {
	const { sellerProfileId, name } = params;
	const trimmed = name.trim();

	// The unique index `brands_seller_name_unique` is defined on
	// (seller_profile_id, lower(name)) — a functional (expression) index.
	// Drizzle's onConflictDoUpdate target array only accepts plain column refs
	// and cannot express functional index targets, so we fall back to a raw
	// SQL query via db.$client (the underlying pg Pool) to produce an atomic
	// upsert against the index expression.
	type BrandRow = {
		id: string;
		seller_profile_id: string;
		name: string;
		created_at: Date;
		updated_at: Date;
	};
	const { rows } = await (db.$client as import("pg").Pool).query<BrandRow>(
		`INSERT INTO brands (id, seller_profile_id, name)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (seller_profile_id, lower(name))
		 DO UPDATE SET updated_at = now()
		 RETURNING *`,
		[crypto.randomUUID(), sellerProfileId, trimmed],
	);
	const r = rows[0];
	return {
		id: r.id,
		sellerProfileId: r.seller_profile_id,
		name: r.name,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}
