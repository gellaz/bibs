import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { store as storeTable } from "@/db/schemas/store";

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
