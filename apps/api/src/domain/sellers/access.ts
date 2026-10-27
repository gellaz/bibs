import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { sellerProfile } from "@/db/schemas/seller";
import { store as storeTable } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";

/**
 * Returns the store IDs an active employee is assigned to AND that are still
 * live (not soft-deleted).
 *
 * An assignment is durable intent, independent of the store's lifecycle: rows
 * survive a soft delete (and come back with a future restore), so liveness is
 * derived here, at the read boundary, rather than by deleting rows. This is the
 * single source of employee scoping — the route gate (`ensureStoreAccess`),
 * `getAccessibleStoreIdsFor` and `settings.assignedStoreIds` all flow from it.
 * See docs/superpowers/specs/2026-09-09-employee-store-assignment-lifecycle-design.md
 *
 * Returns [] if the user has no active employee record for this seller, or if
 * they have no assignments to live stores.
 */
export async function getEmployeeAssignedStoreIds(
	userId: string,
	sellerProfileId: string,
): Promise<string[]> {
	const rows = await db
		.select({ storeId: storeEmployeeStores.storeId })
		.from(storeEmployeeStores)
		.innerJoin(
			storeEmployee,
			eq(storeEmployeeStores.storeEmployeeId, storeEmployee.id),
		)
		.innerJoin(storeTable, eq(storeEmployeeStores.storeId, storeTable.id))
		.where(
			and(
				eq(storeEmployee.userId, userId),
				eq(storeEmployee.sellerProfileId, sellerProfileId),
				eq(storeEmployee.status, "active"),
				isNull(storeTable.deletedAt),
			),
		);
	return rows.map((r) => r.storeId);
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

		if (!profile) throw new ServiceError(403, "Profilo venditore non trovato");
		if (profile.onboardingStatus !== "active")
			throw new ServiceError(403, "Onboarding del venditore non completato");

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

		if (!emp)
			throw new ServiceError(
				403,
				"Accesso negato: nessun incarico attivo come dipendente",
			);
		// Same gate as the owner path: a rejected or not-yet-verified seller's
		// staff must not operate on its behalf.
		if (emp.sellerProfile.onboardingStatus !== "active")
			throw new ServiceError(403, "Onboarding del venditore non completato");
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

	throw new ServiceError(403, "Accesso riservato a venditori e dipendenti");
}
