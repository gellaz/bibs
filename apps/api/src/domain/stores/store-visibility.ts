import { sql } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";

/**
 * SQL boolean predicate (for a WHERE clause) selecting stores that are
 * publicly visible to customers: not soft-deleted AND backed by a subscription
 * in a "live" status (active / past_due / canceling). Suspended, canceled, and
 * subscription-less stores are hidden.
 */
export function publiclyVisibleStore() {
	return sql`(
		${store.deletedAt} IS NULL
		AND EXISTS (
			SELECT 1 FROM ${storeSubscription}
			WHERE ${storeSubscription.storeId} = ${store.id}
			AND ${storeSubscription.status} IN ('active', 'past_due', 'canceling')
		)
	)`;
}
