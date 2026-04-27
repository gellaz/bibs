import { and, asc, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface ListProductCategoriesParams {
	page?: number;
	limit?: number;
	search?: string;
	sortBy?: "name" | "createdAt";
	sortOrder?: "asc" | "desc";
	macroCategoryId?: string;
}

export async function listProductCategories(
	params: ListProductCategoriesParams,
) {
	const { page, limit, offset } = parsePagination(params);

	const filters: SQL[] = [];
	if (params.search) {
		filters.push(ilike(productCategory.name, `%${params.search}%`));
	}
	if (params.macroCategoryId) {
		filters.push(eq(productCategory.macroCategoryId, params.macroCategoryId));
	}
	const where =
		filters.length === 0
			? undefined
			: filters.length === 1
				? filters[0]
				: and(...filters);

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
			with: { macroCategory: true },
		}),
		db.select({ total: count() }).from(productCategory).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

interface CreateProductCategoryParams {
	name: string;
	macroCategoryId: string;
}

export async function createProductCategory(
	params: CreateProductCategoryParams,
) {
	const [created] = await db
		.insert(productCategory)
		.values({ name: params.name, macroCategoryId: params.macroCategoryId })
		.returning();

	return created;
}

interface UpdateProductCategoryParams {
	productCategoryId: string;
	name?: string;
	macroCategoryId?: string;
}

export async function updateProductCategory(
	params: UpdateProductCategoryParams,
) {
	const { productCategoryId, name, macroCategoryId } = params;

	const set: { name?: string; macroCategoryId?: string } = {};
	if (name !== undefined) set.name = name;
	if (macroCategoryId !== undefined) set.macroCategoryId = macroCategoryId;

	if (Object.keys(set).length === 0) {
		const existing = await db.query.productCategory.findFirst({
			where: eq(productCategory.id, productCategoryId),
		});
		if (!existing) throw new ServiceError(404, "Product category not found");
		return existing;
	}

	const [updated] = await db
		.update(productCategory)
		.set(set)
		.where(eq(productCategory.id, productCategoryId))
		.returning();

	if (!updated) throw new ServiceError(404, "Product category not found");
	return updated;
}

export async function deleteProductCategory(productCategoryId: string) {
	const [deleted] = await db
		.delete(productCategory)
		.where(eq(productCategory.id, productCategoryId))
		.returning();

	if (!deleted) throw new ServiceError(404, "Product category not found");
	return deleted;
}
