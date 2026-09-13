import { eq } from "drizzle-orm";
import { db } from "@/db";
import { storeCategory } from "@/db/schemas/store-category";
import { ServiceError } from "@/lib/errors";
import { type ListByNameParams, listByNamePaged } from "./list-by-name-paged";

interface ListStoreCategoriesParams extends ListByNameParams {
	macroCategoryId?: string;
}

export async function listStoreCategories(params: ListStoreCategoriesParams) {
	return listByNamePaged(
		storeCategory,
		params,
		(opts) =>
			db.query.storeCategory.findMany({
				...opts,
				with: { macroCategory: true },
			}),
		[
			params.macroCategoryId
				? eq(storeCategory.macroCategoryId, params.macroCategoryId)
				: undefined,
		],
	);
}

interface CreateStoreCategoryParams {
	name: string;
	macroCategoryId: string;
}

export async function createStoreCategory(params: CreateStoreCategoryParams) {
	const [created] = await db
		.insert(storeCategory)
		.values({ name: params.name, macroCategoryId: params.macroCategoryId })
		.returning();

	return created;
}

interface UpdateStoreCategoryParams {
	categoryId: string;
	name?: string;
	macroCategoryId?: string;
}

export async function updateStoreCategory(params: UpdateStoreCategoryParams) {
	const { categoryId, name, macroCategoryId } = params;

	const set: { name?: string; macroCategoryId?: string } = {};
	if (name !== undefined) set.name = name;
	if (macroCategoryId !== undefined) set.macroCategoryId = macroCategoryId;

	if (Object.keys(set).length === 0) {
		const existing = await db.query.storeCategory.findFirst({
			where: eq(storeCategory.id, categoryId),
		});
		if (!existing) throw new ServiceError(404, "Store category not found");
		return existing;
	}

	const [updated] = await db
		.update(storeCategory)
		.set(set)
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
