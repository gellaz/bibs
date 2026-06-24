import { eq } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { ServiceError } from "@/lib/errors";
import { type ListByNameParams, listByNamePaged } from "./list-by-name-paged";

interface ListProductCategoriesParams extends ListByNameParams {
	macroCategoryId?: string;
}

export async function listProductCategories(
	params: ListProductCategoriesParams,
) {
	return listByNamePaged(
		productCategory,
		params,
		(opts) =>
			db.query.productCategory.findMany({
				...opts,
				with: { macroCategory: true },
			}),
		[
			params.macroCategoryId
				? eq(productCategory.macroCategoryId, params.macroCategoryId)
				: undefined,
		],
	);
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
