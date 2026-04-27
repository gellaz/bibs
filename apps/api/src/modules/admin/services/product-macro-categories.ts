import { asc, count, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface ListProductMacroCategoriesParams {
	page?: number;
	limit?: number;
	search?: string;
	sortBy?: "name" | "createdAt";
	sortOrder?: "asc" | "desc";
}

export async function listProductMacroCategories(
	params: ListProductMacroCategoriesParams,
) {
	const { page, limit, offset } = parsePagination(params);
	const where = params.search
		? ilike(productMacroCategory.name, `%${params.search}%`)
		: undefined;

	const sortCol =
		params.sortBy === "createdAt"
			? productMacroCategory.createdAt
			: productMacroCategory.name;
	const sortDir = params.sortOrder === "desc" ? desc : asc;

	const [data, [{ total }]] = await Promise.all([
		db.query.productMacroCategory.findMany({
			where,
			orderBy: sortDir(sortCol),
			limit,
			offset,
		}),
		db.select({ total: count() }).from(productMacroCategory).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

export async function createProductMacroCategory(name: string) {
	const [created] = await db
		.insert(productMacroCategory)
		.values({ name })
		.returning();

	return created;
}

interface UpdateProductMacroCategoryParams {
	macroCategoryId: string;
	name: string;
}

export async function updateProductMacroCategory(
	params: UpdateProductMacroCategoryParams,
) {
	const { macroCategoryId, name } = params;

	const [updated] = await db
		.update(productMacroCategory)
		.set({ name })
		.where(eq(productMacroCategory.id, macroCategoryId))
		.returning();

	if (!updated) throw new ServiceError(404, "Product macro category not found");
	return updated;
}

export async function deleteProductMacroCategory(macroCategoryId: string) {
	const [{ subCount }] = await db
		.select({ subCount: count() })
		.from(productCategory)
		.where(eq(productCategory.macroCategoryId, macroCategoryId));

	if (subCount > 0) {
		throw new ServiceError(
			409,
			`Cannot delete macro category: ${subCount} sub-categor${subCount === 1 ? "y" : "ies"} still attached`,
		);
	}

	const [deleted] = await db
		.delete(productMacroCategory)
		.where(eq(productMacroCategory.id, macroCategoryId))
		.returning();

	if (!deleted) throw new ServiceError(404, "Product macro category not found");
	return deleted;
}
