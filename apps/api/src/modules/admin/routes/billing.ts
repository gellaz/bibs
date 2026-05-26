import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas";
import { getBillingOverview } from "../services/billing";

const OverviewSchema = t.Object({
	mrrCents: t.Integer(),
	activeStoresCount: t.Integer(),
	pastDueCount: t.Integer(),
	cancelingCount: t.Integer(),
	suspendedCount: t.Integer(),
});

export const adminBillingRoutes = new Elysia({ prefix: "/billing" }).get(
	"/overview",
	async () => {
		const data = await getBillingOverview();
		return ok(data);
	},
	{
		response: withErrors({ 200: okRes(OverviewSchema) }),
		detail: {
			summary: "Overview billing (MRR + counts)",
			description:
				"MRR aggregato e conteggi per stato dei store_subscriptions.",
			tags: ["Admin - Billing"],
		},
	},
);
