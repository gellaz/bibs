import type { InferSelectModel } from "drizzle-orm";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { product } from "@/db/schemas/product";
import type { sellerProfile } from "@/db/schemas/seller";
import { store as storeTable } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";

/**
 * Context injected by the seller guard's `.resolve()` and auth macro.
 * Used as a type assertion in sub-route handlers.
 */
export interface SellerResolvedContext {
	sellerProfile: InferSelectModel<typeof sellerProfile>;
	isOwner: boolean;
	/** Lazy getter — only queries DB on first call, caches the result. */
	getStoreIds: () => Promise<string[]>;
	user: {
		id: string;
		name: string;
		email: string;
		role: string | null;
		[key: string]: unknown;
	};
}

/** Type-safe context helper for seller sub-route handlers. */
export function withSeller<T>(ctx: T) {
	return ctx as T & SellerResolvedContext;
}

/**
 * Returns the IDs of all active (non-deleted) stores for a seller.
 */
export async function getSellerStoreIds(
	sellerProfileId: string,
): Promise<string[]> {
	const stores = await db.query.store.findMany({
		where: and(
			eq(storeTable.sellerProfileId, sellerProfileId),
			isNull(storeTable.deletedAt),
		),
		columns: { id: true },
	});
	return stores.map((s) => s.id);
}

/**
 * Verifies that a product belongs to the given seller profile.
 * Throws 404 if not found.
 */
export async function ensureProductOwnership(
	productId: string,
	sellerProfileId: string,
) {
	const p = await db.query.product.findFirst({
		where: and(
			eq(product.id, productId),
			eq(product.sellerProfileId, sellerProfileId),
		),
	});
	if (!p) throw new ServiceError(404, "Product not found");
	return p;
}

/**
 * Asserts the caller is the owner (not an employee).
 * Throws 403 if not.
 */
export function requireOwner(isOwner: boolean) {
	if (!isOwner)
		throw new ServiceError(403, "Only store owners can perform this action");
}
