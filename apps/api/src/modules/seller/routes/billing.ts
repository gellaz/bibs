import { Elysia, t } from "elysia";
import { storeSubscriptionStatuses } from "@/db/schemas/store-subscription";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas";
import { withSeller } from "../context";
import {
	createPortalSession,
	getBillingSummary,
	listBillingSubscriptions,
} from "../services/billing";

const SummarySchema = t.Object({
	totalMonthlyCents: t.Integer(),
	activeStoresCount: t.Integer(),
	nextRenewal: t.Nullable(
		t.Object({
			storeId: t.String(),
			storeName: t.String(),
			date: t.Date(),
			amountCents: t.Integer(),
		}),
	),
});

const StatusUnion = t.Union(storeSubscriptionStatuses.map((s) => t.Literal(s)));

const SubscriptionRowSchema = t.Object({
	storeId: t.String(),
	storeName: t.String(),
	status: StatusUnion,
	feeAmountCents: t.Integer(),
	currency: t.String(),
	currentPeriodEnd: t.Date(),
	cancelAtPeriodEnd: t.Boolean(),
	suspendedAt: t.Nullable(t.Date()),
});

const PortalSchema = t.Object({ url: t.String() });

export const billingRoutes = new Elysia({ prefix: "/billing" })
	.get(
		"/summary",
		async (ctx) => {
			const { sellerProfile: sp } = withSeller(ctx);
			const data = await getBillingSummary({ sellerProfileId: sp.id });
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(SummarySchema) }),
			detail: {
				summary: "Riepilogo billing",
				description:
					"Totale mensile, conteggio negozi attivi, prossimo rinnovo.",
				tags: ["Seller - Billing"],
			},
		},
	)
	.get(
		"/subscriptions",
		async (ctx) => {
			const { sellerProfile: sp } = withSeller(ctx);
			const data = await listBillingSubscriptions({ sellerProfileId: sp.id });
			return ok(data) as any;
		},
		{
			response: withErrors({ 200: okRes(t.Array(SubscriptionRowSchema)) }),
			detail: {
				summary: "Lista subscription del seller",
				description: "Esclude i sub canceled (archivio).",
				tags: ["Seller - Billing"],
			},
		},
	)
	.post(
		"/portal",
		async (ctx) => {
			const { sellerProfile: sp } = withSeller(ctx);
			const data = await createPortalSession({
				sellerProfileId: sp.id,
				stripeCustomerId: sp.stripeCustomerId ?? null,
			});
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(PortalSchema) }),
			detail: {
				summary: "Customer Portal session",
				description:
					"Crea una sessione di Stripe Customer Portal e ritorna l'URL.",
				tags: ["Seller - Billing"],
			},
		},
	);
