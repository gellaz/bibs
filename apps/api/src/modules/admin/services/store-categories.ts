import { asc, count, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { storeCategory } from "@/db/schemas/store-category";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface ListStoreCategoriesParams {
	page?: number;
	limit?: number;
	search?: string;
	sortBy?: "name" | "createdAt";
	sortOrder?: "asc" | "desc";
}

export async function listStoreCategories(params: ListStoreCategoriesParams) {
	const { page, limit, offset } = parsePagination(params);
	const where = params.search
		? ilike(storeCategory.name, `%${params.search}%`)
		: undefined;

	const sortCol =
		params.sortBy === "createdAt"
			? storeCategory.createdAt
			: storeCategory.name;
	const sortDir = params.sortOrder === "desc" ? desc : asc;

	const [data, [{ total }]] = await Promise.all([
		db.query.storeCategory.findMany({
			where,
			orderBy: sortDir(sortCol),
			limit,
			offset,
		}),
		db.select({ total: count() }).from(storeCategory).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

export async function createStoreCategory(name: string) {
	const [created] = await db.insert(storeCategory).values({ name }).returning();

	return created;
}

interface UpdateStoreCategoryParams {
	categoryId: string;
	name: string;
}

export async function updateStoreCategory(params: UpdateStoreCategoryParams) {
	const { categoryId, name } = params;

	const [updated] = await db
		.update(storeCategory)
		.set({ name })
		.where(eq(storeCategory.id, categoryId))
		.returning();

	if (!updated) throw new ServiceError(404, "Store category not found");
	return updated;
}

export async function deleteStoreCategory(categoryId: string) {
	const [deleted] = await db
		.delete(storeCategory)
		.where(eq(storeCategory.id, categoryId))
		.returning();

	if (!deleted) throw new ServiceError(404, "Store category not found");
	return deleted;
}
