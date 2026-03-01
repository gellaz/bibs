import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface ListCategoriesParams {
	page?: number;
	limit?: number;
}

export async function listCategories(params: ListCategoriesParams) {
	const { page, limit, offset } = parsePagination(params);

	const [data, [{ total }]] = await Promise.all([
		db.query.productCategory.findMany({ limit, offset }),
		db.select({ total: count() }).from(productCategory),
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
