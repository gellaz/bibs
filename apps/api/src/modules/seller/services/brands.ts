import { and, count, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { brand } from "@/db/schemas/brand";
import { containsPattern } from "@/lib/like";
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
				ilike(brand.name, containsPattern(q)),
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
