import type { InferSelectModel } from "drizzle-orm";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { product } from "@/db/schemas/product";
import type { sellerProfile } from "@/db/schemas/seller";
import { store as storeTable } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { getEmployeeAssignedStoreIds } from "./services/access";

/**
 * Context injected by the seller guard's `.resolve()` and auth macro.
 * Used as a type assertion in sub-route handlers.
 */
export interface SellerResolvedContext {
	sellerProfile: InferSelectModel<typeof sellerProfile>;
	isOwner: boolean;
	/** Lazy getter — only queries DB on first call, caches the result. */
	getStoreIds: () => Promise<string[]>;
	/** Lazy: tutti gli store accessibili al chiamante (owner: tutti; employee: solo assegnati). */
	getAccessibleStoreIds: () => Promise<string[]>;
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
 * Verifies that a store belongs to the given seller profile.
 * Throws 404 if not found.
 */
export async function ensureStoreOwnership(
	storeId: string,
	sellerProfileId: string,
) {
	const s = await db.query.store.findFirst({
		where: and(
			eq(storeTable.id, storeId),
			eq(storeTable.sellerProfileId, sellerProfileId),
			isNull(storeTable.deletedAt),
		),
	});
	if (!s) throw new ServiceError(404, "Store not found");
	return s;
}

export interface AccessCtx {
	userId: string;
	sellerProfileId: string;
	isOwner: boolean;
}

/**
 * Owner: tutti gli store non-deleted del sellerProfile.
 * Employee: solo gli storeId presenti in store_employee_stores per il chiamante.
 */
export async function getAccessibleStoreIdsFor(
	ctx: AccessCtx,
): Promise<string[]> {
	if (ctx.isOwner) return getSellerStoreIds(ctx.sellerProfileId);
	return getEmployeeAssignedStoreIds(ctx.userId, ctx.sellerProfileId);
}

/**
 * Throws 404 (owner) o 403 (employee) se il chiamante non può operare sullo store.
 * Owner: verifica via ensureStoreOwnership (404 se non appartiene al seller o cancellato).
 * Employee: 403 se storeId non in assignedStoreIds, anche se lo store esiste e appartiene al seller.
 */
export async function ensureStoreAccess(
	storeId: string,
	ctx: AccessCtx,
): Promise<void> {
	if (ctx.isOwner) {
		await ensureStoreOwnership(storeId, ctx.sellerProfileId);
		return;
	}
	const assigned = await getEmployeeAssignedStoreIds(
		ctx.userId,
		ctx.sellerProfileId,
	);
	if (!assigned.includes(storeId)) {
		throw new ServiceError(403, "Accesso negato a questo negozio");
	}
}

/**
 * Asserts the caller is the owner (not an employee).
 * Throws 403 if not.
 */
export function requireOwner(isOwner: boolean) {
	if (!isOwner)
		throw new ServiceError(403, "Only store owners can perform this action");
}

/**
 * Context injected by the auth macro for profile routes.
 * Used for routes that need authentication but not VAT verification.
 */
export interface SellerAuthContext {
	user: {
		id: string;
		name: string;
		email: string;
		role: string | null;
		[key: string]: unknown;
	};
}

/** Type-safe context helper for profile routes (no VAT verification). */
export function withSellerAuth<T>(ctx: T) {
	return ctx as T & SellerAuthContext;
}
