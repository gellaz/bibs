import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { ServiceError } from "@/lib/errors";
import type { VatRate } from "@/lib/vat";
import { type ListByNameParams, listByNamePaged } from "./list-by-name-paged";

export async function listProductMacroCategories(params: ListByNameParams) {
	return listByNamePaged(productMacroCategory, params, (opts) =>
		db.query.productMacroCategory.findMany(opts),
	);
}

export async function createProductMacroCategory(params: {
	name: string;
	suggestedVatRate?: VatRate;
}) {
	const [created] = await db
		.insert(productMacroCategory)
		.values({
			name: params.name,
			...(params.suggestedVatRate
				? { suggestedVatRate: params.suggestedVatRate }
				: {}),
		})
		.returning();

	return created;
}

interface UpdateProductMacroCategoryParams {
	macroCategoryId: string;
	name: string;
	suggestedVatRate?: VatRate;
}

export async function updateProductMacroCategory(
	params: UpdateProductMacroCategoryParams,
) {
	const { macroCategoryId, name, suggestedVatRate } = params;

	const [updated] = await db
		.update(productMacroCategory)
		.set({
			name,
			...(suggestedVatRate ? { suggestedVatRate } : {}),
		})
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
