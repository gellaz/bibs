import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";

/**
 * Returns the store IDs an active employee is assigned to.
 * Returns [] if the user has no active employee record for this seller,
 * or if they have no assignments.
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
		.where(
			and(
				eq(storeEmployee.userId, userId),
				eq(storeEmployee.sellerProfileId, sellerProfileId),
				eq(storeEmployee.status, "active"),
			),
		);
	return rows.map((r) => r.storeId);
}
