import { eq } from "drizzle-orm";
import { db } from "@/db";
import { storeCategory } from "@/db/schemas/store-category";
import { ServiceError } from "@/lib/errors";
import { type ListByNameParams, listByNamePaged } from "./list-by-name-paged";

export async function listStoreCategories(params: ListByNameParams) {
	return listByNamePaged(storeCategory, params, (opts) =>
		db.query.storeCategory.findMany(opts),
	);
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
