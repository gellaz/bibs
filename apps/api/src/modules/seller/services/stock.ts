import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { product, storeProduct } from "@/db/schemas/product";
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
	const { productId, sellerProfileId, storeIds, stock } = params;
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
				stock: stock ?? 0,
			})),
		)
		.onConflictDoUpdate({
			target: [storeProduct.productId, storeProduct.storeId],
			// Re-assigning a product to a store it's already linked to must not
			// silently wipe its inventory: only overwrite stock when an explicit
			// value was provided, otherwise preserve the existing row's stock.
			// (Stock is otherwise managed via updateStock / adjustStock.)
			set: {
				stock:
					stock === undefined
						? sql`${storeProduct.stock}`
						: sql`excluded.stock`,
			},
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

// ── adjustStock ───────────────────────────────────────────────────────────────

interface AdjustStockParams {
	productId: string;
	storeId: string;
	sellerProfileId: string;
	delta: number;
}

export async function adjustStock(params: AdjustStockParams) {
	const { productId, storeId, sellerProfileId, delta } = params;
	await ensureProductOwnership(productId, sellerProfileId);

	// UPDATE atomico con guard non-negative: una sola query, niente race.
	const [updated] = await db
		.update(storeProduct)
		.set({ stock: sql`${storeProduct.stock} + ${delta}` })
		.where(
			and(
				eq(storeProduct.productId, productId),
				eq(storeProduct.storeId, storeId),
				sql`${storeProduct.stock} + ${delta} >= 0`,
			),
		)
		.returning();

	if (updated) return updated;

	// rowCount = 0 → distingui 404 (link assente) da 409 (vincolo violato).
	const existing = await db.query.storeProduct.findFirst({
		where: and(
			eq(storeProduct.productId, productId),
			eq(storeProduct.storeId, storeId),
		),
	});
	if (!existing) throw new ServiceError(404, "Store-product link not found");
	throw new ServiceError(409, "Stock would go negative");
}

// ── bulkAdjustStock ───────────────────────────────────────────────────────────

interface BulkAdjustStockParams {
	sellerProfileId: string;
	storeId: string;
	productIds: string[];
	mode: "delta" | "set";
	value: number;
}

interface BulkAdjustFailure {
	productId: string;
	reason: "not_found" | "would_go_negative";
}

export async function bulkAdjustStock(params: BulkAdjustStockParams) {
	const { sellerProfileId, storeId, productIds, mode, value } = params;

	if (productIds.length === 0) return { succeeded: [], failed: [] };

	// 1. Filtra i productIds per ownership: non leakare cross-seller.
	const ownedRows = await db
		.select({ id: product.id })
		.from(product)
		.where(
			and(
				inArray(product.id, productIds),
				eq(product.sellerProfileId, sellerProfileId),
			),
		);
	const ownedSet = new Set(ownedRows.map((r) => r.id));
	// Preserve original productIds order in failed[].
	const ownedInOrder = productIds.filter((id) => ownedSet.has(id));

	const failed: BulkAdjustFailure[] = [];
	for (const pid of productIds) {
		if (!ownedSet.has(pid))
			failed.push({ productId: pid, reason: "not_found" });
	}

	// 2. Per ogni id owned: UPDATE atomico per-row, wrapped in a transaction
	//    so a transient DB error doesn't leave a partial update committed.
	return db.transaction(async (tx) => {
		const succeeded: Awaited<ReturnType<typeof adjustStock>>[] = [];
		for (const productId of ownedInOrder) {
			if (mode === "delta") {
				const [updated] = await tx
					.update(storeProduct)
					.set({ stock: sql`${storeProduct.stock} + ${value}` })
					.where(
						and(
							eq(storeProduct.productId, productId),
							eq(storeProduct.storeId, storeId),
							sql`${storeProduct.stock} + ${value} >= 0`,
						),
					)
					.returning();
				if (updated) {
					succeeded.push(updated);
					continue;
				}
				// discrimina 404 vs would_go_negative
				const existing = await tx.query.storeProduct.findFirst({
					where: and(
						eq(storeProduct.productId, productId),
						eq(storeProduct.storeId, storeId),
					),
				});
				failed.push({
					productId,
					reason: existing ? "would_go_negative" : "not_found",
				});
			} else {
				// mode = "set"
				const [updated] = await tx
					.update(storeProduct)
					.set({ stock: value })
					.where(
						and(
							eq(storeProduct.productId, productId),
							eq(storeProduct.storeId, storeId),
						),
					)
					.returning();
				if (updated) {
					succeeded.push(updated);
					continue;
				}
				failed.push({ productId, reason: "not_found" });
			}
		}

		return { succeeded, failed };
	});
}
