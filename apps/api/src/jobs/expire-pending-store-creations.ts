import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { logger } from "@/lib/logger";

export async function runExpirePending(): Promise<{ expired: number }> {
	const now = new Date();

	const result = await db
		.update(pendingStoreCreation)
		.set({ status: "expired" })
		.where(
			and(
				eq(pendingStoreCreation.status, "open"),
				lt(pendingStoreCreation.expiresAt, now),
			),
		)
		.returning({ id: pendingStoreCreation.id });

	if (result.length > 0) {
		logger.info({ count: result.length }, "Expired pending store creations");
	}
	return { expired: result.length };
}
