import { Hono } from "hono";
import { z } from "zod";
import { storeSubscriptionStatuses } from "@/db/schemas/store-subscription";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas/responses";
import { zDate, zInteger } from "@/lib/schemas/t";
import { requireOwner } from "../context";
import {
	createPortalSession,
	getBillingSummary,
	listBillingSubscriptions,
	listInvoices,
} from "../services/billing";

const security = [{ bearerAuth: [] }];
const tags = ["Seller - Billing"];

const SummaryRes = okRes(
	z.object({
		totalMonthlyCents: zInteger(),
		billableStoresCount: zInteger({
			description:
				"Negozi con abbonamento fatturabile (active, past_due, canceling): quelli sommati in totalMonthlyCents",
		}),
		nextRenewal: z
			.object({
				storeId: z.string(),
				storeName: z.string(),
				date: zDate(),
				amountCents: zInteger(),
			})
			.nullable(),
	}),
);

const SubscriptionsRes = okRes(
	z.array(
		z.object({
			storeId: z.string(),
			storeName: z.string(),
			status: z.enum(storeSubscriptionStatuses),
			feeAmountCents: zInteger(),
			currency: z.string(),
			currentPeriodEnd: zDate(),
			cancelAtPeriodEnd: z.boolean(),
			suspendedAt: zDate().nullable(),
		}),
	),
);

const PortalRes = okRes(z.object({ url: z.string() }));

const InvoicesRes = okRes(
	z.object({
		data: z.array(
			z.object({
				id: z.string(),
				createdAt: zDate(),
				totalCents: zInteger(),
				currency: z.string(),
				status: z.string().nullable(),
				invoicePdfUrl: z.string().nullable(),
				stripeSubscriptionId: z.string().nullable(),
				description: z.string().nullable(),
			}),
		),
		hasMore: z.boolean(),
	}),
);

export const billingRoutes = new Hono()
	.get(
		"/billing/summary",
		doc({
			response: withErrors({ 200: SummaryRes }),
			detail: {
				summary: "Riepilogo billing",
				description:
					"Totale mensile, conteggio negozi attivi, prossimo rinnovo.",
				tags,
				security,
			},
		}),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await getBillingSummary({ sellerProfileId: sp.id });
			return send(c, SummaryRes, ok(data));
		},
	)
	.get(
		"/billing/subscriptions",
		doc({
			response: withErrors({ 200: SubscriptionsRes }),
			detail: {
				summary: "Lista subscription del seller",
				description: "Esclude i sub canceled (archivio).",
				tags,
				security,
			},
		}),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await listBillingSubscriptions({ sellerProfileId: sp.id });
			return send(c, SubscriptionsRes, ok(data));
		},
	)
	.post(
		"/billing/portal",
		doc({
			response: withErrors({ 200: PortalRes }),
			detail: {
				summary: "Customer Portal session",
				description:
					"Crea una sessione di Stripe Customer Portal e ritorna l'URL.",
				tags,
				security,
			},
		}),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await createPortalSession({
				sellerProfileId: sp.id,
				stripeCustomerId: sp.stripeCustomerId ?? null,
			});
			return send(c, PortalRes, ok(data));
		},
	)
	.get(
		"/billing/invoices",
		doc({
			response: withErrors({ 200: InvoicesRes }),
			detail: {
				summary: "Storico fatture (Stripe lazy)",
				description:
					"Recupera le fatture dal Customer Stripe. Max 100/req, paging via starting_after.",
				tags,
				security,
			},
		}),
		v(
			"query",
			z.object({
				limit: zInteger({ minimum: 1, maximum: 100 }).optional(),
				startingAfter: z.string().optional(),
			}),
		),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const query = c.req.valid("query");
			const data = await listInvoices({
				sellerProfileId: sp.id,
				limit: query.limit ?? 25,
				startingAfter: query.startingAfter,
			});
			return send(c, InvoicesRes, ok(data));
		},
	);
