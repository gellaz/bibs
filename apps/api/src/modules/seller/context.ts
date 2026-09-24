import type { InferSelectModel } from "drizzle-orm";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { storeEmployee } from "@/db/schemas/employee";
import { product, storeProduct } from "@/db/schemas/product";
import { sellerProfile } from "@/db/schemas/seller";
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
	/** The caller's access triple, assembled by the seller guard's resolve. */
	accessCtx: AccessCtx;
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
 * Product-level sibling of {@link ensureStoreAccess}.
 * Owner: 404 se il prodotto non appartiene al seller (qualunque store, anche
 * non assegnato a nessuno).
 * Employee: 404 se non è del seller; 403 se il prodotto non è in stock in
 * nessuno degli store assegnati al chiamante.
 */
export async function ensureProductAccess(
	productId: string,
	ctx: AccessCtx,
): Promise<void> {
	await ensureProductOwnership(productId, ctx.sellerProfileId);
	if (ctx.isOwner) return;
	const assigned = await getEmployeeAssignedStoreIds(
		ctx.userId,
		ctx.sellerProfileId,
	);
	const rows = await db.query.storeProduct.findMany({
		where: eq(storeProduct.productId, productId),
		columns: { storeId: true },
	});
	if (!rows.some((r) => assigned.includes(r.storeId))) {
		throw new ServiceError(403, "Accesso negato a questo prodotto");
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

/**
 * The seller guard's resolve: who is calling and which seller they act for.
 * Owners and employees must both belong to a seller whose onboarding is
 * active. Extracted from the module so it can be tested against the DB.
 */
export async function resolveSellerAccess(u: {
	id: string;
	role?: string | null;
}) {
	// Owner path: user is a seller with completed onboarding
	if (u.role === "seller") {
		const profile = await db.query.sellerProfile.findFirst({
			where: eq(sellerProfile.userId, u.id),
		});

		if (!profile) throw new ServiceError(403, "Seller profile not found");
		if (profile.onboardingStatus !== "active")
			throw new ServiceError(403, "Seller onboarding not completed");

		const accessCtx: AccessCtx = {
			userId: u.id,
			sellerProfileId: profile.id,
			isOwner: true,
		};

		let cached: Promise<string[]> | null = null;
		const getStoreIds = () => (cached ??= getSellerStoreIds(profile.id));

		let cachedAccessible: Promise<string[]> | null = null;
		const getAccessibleStoreIds = () =>
			(cachedAccessible ??= getAccessibleStoreIdsFor(accessCtx));

		return {
			sellerProfile: profile,
			isOwner: true as const,
			accessCtx,
			getStoreIds,
			getAccessibleStoreIds,
		};
	}

	// Employee path: user is an active employee
	if (u.role === "employee") {
		const emp = await db.query.storeEmployee.findFirst({
			where: and(
				eq(storeEmployee.userId, u.id),
				eq(storeEmployee.status, "active"),
			),
			with: { sellerProfile: true },
		});

		if (!emp) throw new ServiceError(403, "Employee access denied");
		// Same gate as the owner path: a rejected or not-yet-verified seller's
		// staff must not operate on its behalf.
		if (emp.sellerProfile.onboardingStatus !== "active")
			throw new ServiceError(403, "Seller onboarding not completed");
		const accessCtx: AccessCtx = {
			userId: u.id,
			sellerProfileId: emp.sellerProfile.id,
			isOwner: false,
		};

		let cached: Promise<string[]> | null = null;
		const getStoreIds = () =>
			(cached ??= getSellerStoreIds(emp.sellerProfile.id));

		let cachedAccessible: Promise<string[]> | null = null;
		const getAccessibleStoreIds = () =>
			(cachedAccessible ??= getAccessibleStoreIdsFor(accessCtx));

		return {
			sellerProfile: emp.sellerProfile,
			isOwner: false as const,
			accessCtx,
			getStoreIds,
			getAccessibleStoreIds,
		};
	}

	throw new ServiceError(403, "Not a seller or employee");
}
