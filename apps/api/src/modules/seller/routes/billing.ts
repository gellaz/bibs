import { Elysia, t } from "elysia";
import { storeSubscriptionStatuses } from "@/db/schemas/store-subscription";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas";
import { requireOwner, withSeller } from "../context";
import {
	createPortalSession,
	getBillingSummary,
	listBillingSubscriptions,
	listInvoices,
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

const InvoiceSchema = t.Object({
	id: t.String(),
	createdAt: t.Date(),
	amountPaidCents: t.Integer(),
	currency: t.String(),
	status: t.Nullable(t.String()),
	invoicePdfUrl: t.Nullable(t.String()),
	stripeSubscriptionId: t.Nullable(t.String()),
	description: t.Nullable(t.String()),
});

const InvoicesPageSchema = t.Object({
	data: t.Array(InvoiceSchema),
	hasMore: t.Boolean(),
});

export const billingRoutes = new Elysia({ prefix: "/billing" })
	.get(
		"/summary",
		async (ctx) => {
			const { sellerProfile: sp, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
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
			const { sellerProfile: sp, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
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
			const { sellerProfile: sp, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
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
	)
	.get(
		"/invoices",
		async (ctx) => {
			const { sellerProfile: sp, query, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const data = await listInvoices({
				sellerProfileId: sp.id,
				limit: query.limit ?? 25,
				startingAfter: query.startingAfter,
			});
			return ok(data);
		},
		{
			query: t.Object({
				limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
				startingAfter: t.Optional(t.String()),
			}),
			response: withErrors({ 200: okRes(InvoicesPageSchema) }),
			detail: {
				summary: "Storico fatture (Stripe lazy)",
				description:
					"Recupera le fatture dal Customer Stripe. Max 100/req, paging via starting_after.",
				tags: ["Seller - Billing"],
			},
		},
	);
