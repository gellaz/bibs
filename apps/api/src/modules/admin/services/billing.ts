import { sql } from "drizzle-orm";
import { db } from "@/db";
import { storeSubscription } from "@/db/schemas/store-subscription";

export async function getBillingOverview() {
	const rows = await db
		.select({
			status: storeSubscription.status,
			count: sql<number>`count(*)::int`,
			sumCents: sql<number>`coalesce(sum(${storeSubscription.feeAmountCents}), 0)::int`,
		})
		.from(storeSubscription)
		.groupBy(storeSubscription.status);

	let mrrCents = 0;
	let activeStoresCount = 0;
	let pastDueCount = 0;
	let cancelingCount = 0;
	let suspendedCount = 0;

	for (const r of rows) {
		if (r.status === "active") {
			activeStoresCount = r.count;
			mrrCents += r.sumCents;
		} else if (r.status === "past_due") {
			pastDueCount = r.count;
			mrrCents += r.sumCents;
		} else if (r.status === "canceling") {
			cancelingCount = r.count;
			mrrCents += r.sumCents;
		} else if (r.status === "suspended") {
			suspendedCount = r.count;
		}
	}

	return {
		mrrCents,
		activeStoresCount,
		pastDueCount,
		cancelingCount,
		suspendedCount,
	};
}
