import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { storeCategory } from "@/db/schemas/store-category";
import { storeMacroCategory } from "@/db/schemas/store-macro-category";
import { ServiceError } from "@/lib/errors";
import { type ListByNameParams, listByNamePaged } from "./list-by-name-paged";

export async function listStoreMacroCategories(params: ListByNameParams) {
	return listByNamePaged(storeMacroCategory, params, (opts) =>
		db.query.storeMacroCategory.findMany(opts),
	);
}

export async function createStoreMacroCategory(name: string) {
	const [created] = await db
		.insert(storeMacroCategory)
		.values({ name })
		.returning();

	return created;
}

interface UpdateStoreMacroCategoryParams {
	macroCategoryId: string;
	name: string;
}

export async function updateStoreMacroCategory(
	params: UpdateStoreMacroCategoryParams,
) {
	const { macroCategoryId, name } = params;

	const [updated] = await db
		.update(storeMacroCategory)
		.set({ name })
		.where(eq(storeMacroCategory.id, macroCategoryId))
		.returning();

	if (!updated) throw new ServiceError(404, "Store macro category not found");
	return updated;
}

export async function deleteStoreMacroCategory(macroCategoryId: string) {
	const [{ subCount }] = await db
		.select({ subCount: count() })
		.from(storeCategory)
		.where(eq(storeCategory.macroCategoryId, macroCategoryId));

	if (subCount > 0) {
		throw new ServiceError(
			409,
			`Cannot delete macro category: ${subCount} sub-categor${subCount === 1 ? "y" : "ies"} still attached`,
		);
	}

	const [deleted] = await db
		.delete(storeMacroCategory)
		.where(eq(storeMacroCategory.id, macroCategoryId))
		.returning();

	if (!deleted) throw new ServiceError(404, "Store macro category not found");
	return deleted;
}
