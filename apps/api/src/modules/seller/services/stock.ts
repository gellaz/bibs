import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { storeProduct } from "@/db/schemas/product";
import { store as storeTable } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { ensureProductOwnership } from "../context";

interface AssignProductToStoresParams {
	productId: string;
	sellerProfileId: string;
	storeIds: string[];
	stock?: number;
}

export async function assignProductToStores(
	params: AssignProductToStoresParams,
) {
	const { productId, sellerProfileId, storeIds, stock = 0 } = params;
	await ensureProductOwnership(productId, sellerProfileId);

	const sellerStores = await db.query.store.findMany({
		where: and(
			inArray(storeTable.id, storeIds),
			eq(storeTable.sellerProfileId, sellerProfileId),
		),
	});
	if (sellerStores.length !== storeIds.length)
		throw new ServiceError(400, "One or more stores not found");

	const rows = await db
		.insert(storeProduct)
		.values(
			storeIds.map((storeId) => ({
				productId,
				storeId,
				stock,
			})),
		)
		.onConflictDoUpdate({
			target: [storeProduct.productId, storeProduct.storeId],
			set: { stock: sql`excluded.stock` },
		})
		.returning();

	return rows;
}

interface UpdateStockParams {
	productId: string;
	storeId: string;
	sellerProfileId: string;
	stock: number;
}

export async function updateStock(params: UpdateStockParams) {
	const { productId, storeId, sellerProfileId, stock } = params;
	await ensureProductOwnership(productId, sellerProfileId);

	const [updated] = await db
		.update(storeProduct)
		.set({ stock })
		.where(
			and(
				eq(storeProduct.productId, productId),
				eq(storeProduct.storeId, storeId),
			),
		)
		.returning();

	if (!updated) throw new ServiceError(404, "Store-product link not found");
	return updated;
}

interface RemoveProductFromStoreParams {
	productId: string;
	storeId: string;
	sellerProfileId: string;
}

export async function removeProductFromStore(
	params: RemoveProductFromStoreParams,
) {
	const { productId, storeId, sellerProfileId } = params;
	await ensureProductOwnership(productId, sellerProfileId);

	const [deleted] = await db
		.delete(storeProduct)
		.where(
			and(
				eq(storeProduct.productId, productId),
				eq(storeProduct.storeId, storeId),
			),
		)
		.returning();

	if (!deleted) throw new ServiceError(404, "Store-product link not found");
	return deleted;
}
