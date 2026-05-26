import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	getBillingOverview,
	getCurrentPricing,
	listPricingHistory,
	updatePricing,
} from "../services/billing";

const OverviewSchema = t.Object({
	mrrCents: t.Integer(),
	activeStoresCount: t.Integer(),
	pastDueCount: t.Integer(),
	cancelingCount: t.Integer(),
	suspendedCount: t.Integer(),
});

const PricingSchema = t.Object({
	id: t.String(),
	storeMonthlyFeeCents: t.Integer(),
	currency: t.String(),
	stripePriceId: t.String(),
	suspendedAutoCancelDays: t.Integer(),
	pendingCreationExpiryHours: t.Integer(),
	isActive: t.Boolean(),
	createdAt: t.Date(),
	createdByUserId: t.Nullable(t.String()),
});

export const adminBillingRoutes = new Elysia({ prefix: "/billing" })
	.get(
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
	)
	.get(
		"/pricing/current",
		async () => {
			const data = await getCurrentPricing();
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(PricingSchema) }),
			detail: {
				summary: "Pricing config attivo",
				description: "Restituisce la riga pricing_config con is_active=true.",
				tags: ["Admin - Billing"],
			},
		},
	)
	.get(
		"/pricing/history",
		async () => {
			const data = await listPricingHistory();
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(t.Array(PricingSchema)) }),
			detail: {
				summary: "Storico configurazioni pricing",
				description: "Tutte le righe pricing_config in ordine decrescente.",
				tags: ["Admin - Billing"],
			},
		},
	)
	.put(
		"/pricing",
		async (ctx) => {
			const { user, body } = withAdmin(ctx) as ReturnType<typeof withAdmin> & {
				body: {
					storeMonthlyFeeCents: number;
					currency: string;
					suspendedAutoCancelDays: number;
					pendingCreationExpiryHours: number;
					productId: string;
				};
			};
			const data = await updatePricing({
				...body,
				adminUserId: user.id,
			});
			return ok(data);
		},
		{
			body: t.Object({
				storeMonthlyFeeCents: t.Integer({ minimum: 100 }),
				currency: t.String({ minLength: 3, maxLength: 3 }),
				suspendedAutoCancelDays: t.Integer({ minimum: 7, maximum: 365 }),
				pendingCreationExpiryHours: t.Integer({ minimum: 1, maximum: 168 }),
				productId: t.String(),
			}),
			response: withErrors({
				200: okRes(t.Object({ newPriceId: t.String() })),
			}),
			detail: {
				summary: "Aggiorna pricing",
				description:
					"Crea un nuovo Stripe Price e flip is_active sulla nuova riga pricing_config.",
				tags: ["Admin - Billing"],
			},
		},
	);
