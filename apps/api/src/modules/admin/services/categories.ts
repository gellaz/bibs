import { asc, count, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface ListCategoriesParams {
	page?: number;
	limit?: number;
	search?: string;
	sortBy?: "name" | "createdAt";
	sortOrder?: "asc" | "desc";
}

export async function listCategories(params: ListCategoriesParams) {
	const { page, limit, offset } = parsePagination(params);
	const where = params.search
		? ilike(productCategory.name, `%${params.search}%`)
		: undefined;

	const sortCol =
		params.sortBy === "createdAt"
			? productCategory.createdAt
			: productCategory.name;
	const sortDir = params.sortOrder === "desc" ? desc : asc;

	const [data, [{ total }]] = await Promise.all([
		db.query.productCategory.findMany({
			where,
			orderBy: sortDir(sortCol),
			limit,
			offset,
		}),
		db.select({ total: count() }).from(productCategory).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

export async function createCategory(name: string) {
	const [created] = await db
		.insert(productCategory)
		.values({ name })
		.returning();

	return created;
}

interface UpdateCategoryParams {
	categoryId: string;
	name: string;
}

export async function updateCategory(params: UpdateCategoryParams) {
	const { categoryId, name } = params;

	const [updated] = await db
		.update(productCategory)
		.set({ name })
		.where(eq(productCategory.id, categoryId))
		.returning();

	if (!updated) throw new ServiceError(404, "Category not found");
	return updated;
}

export async function deleteCategory(categoryId: string) {
	const [deleted] = await db
		.delete(productCategory)
		.where(eq(productCategory.id, categoryId))
		.returning();

	if (!deleted) throw new ServiceError(404, "Category not found");
	return deleted;
}
