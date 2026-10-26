import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { ok } from "@/lib/responses";
import { okRes, withConflictErrors, withErrors } from "@/lib/zod/responses";
import { zDate, zInteger, zString } from "@/lib/zod/t";
import { adminDetail } from "../context";
import {
	getBillingOverview,
	getCurrentPricing,
	listAllSubscriptions,
	listPricingHistory,
	updatePricing,
} from "../services/billing";

const detail = (summary: string, description: string) => ({
	...adminDetail(summary, description),
	tags: ["Admin - Billing"],
});

const StatusUnion = z.enum([
	"active",
	"past_due",
	"canceling",
	"suspended",
	"canceled",
]);

const SubRowSchema = z.object({
	id: z.string(),
	storeId: z.string(),
	storeName: z.string(),
	sellerEmail: z.string(),
	status: StatusUnion,
	feeAmountCents: zInteger(),
	currentPeriodEnd: zDate(),
	createdAt: zDate(),
	cancelReason: z.string().nullable(),
});

const SubsPageSchema = z.object({
	data: z.array(SubRowSchema),
	pagination: z.object({
		page: zInteger(),
		limit: zInteger(),
		total: zInteger(),
	}),
});

const OverviewSchema = z.object({
	mrrCents: zInteger(),
	atRiskCents: zInteger({
		description:
			"Somma fee di subscription past_due + canceling: revenue mensile a rischio, esclusa dall'MRR",
	}),
	activeStoresCount: zInteger(),
	pastDueCount: zInteger(),
	cancelingCount: zInteger(),
	suspendedCount: zInteger(),
});

const PricingSchema = z.object({
	id: z.string(),
	storeMonthlyFeeCents: zInteger(),
	currency: z.string(),
	stripePriceId: z.string(),
	stripeProductId: z.string().nullable(),
	suspendedAutoCancelDays: zInteger(),
	pendingCreationExpiryHours: zInteger(),
	isActive: z.boolean(),
	createdAt: zDate(),
	createdByUserId: z.string().nullable(),
});

const OverviewResponse = okRes(OverviewSchema);
const PricingResponse = okRes(PricingSchema);
const PricingHistoryResponse = okRes(z.array(PricingSchema));
const UpdatePricingResponse = okRes(z.object({ newPriceId: z.string() }));
const SubscriptionsResponse = okRes(SubsPageSchema);

export const UpdatePricingBody = z.object({
	storeMonthlyFeeCents: zInteger({ minimum: 100 }),
	currency: zString({ minLength: 3, maxLength: 3 }),
	suspendedAutoCancelDays: zInteger({ minimum: 7, maximum: 365 }),
	pendingCreationExpiryHours: zInteger({ minimum: 1, maximum: 168 }),
	productId: zString({
		pattern: "^prod_[A-Za-z0-9]+$",
		description:
			"ID del prodotto Stripe (prod_…) a cui agganciare il nuovo prezzo",
	}),
});

export const SubscriptionsQuery = z.object({
	page: zInteger({ minimum: 1 }).optional(),
	limit: zInteger({ minimum: 1, maximum: 100 }).optional(),
	status: StatusUnion.optional(),
	sellerEmail: z.string().optional(),
	storeName: z.string().optional(),
});

export const adminBillingRoutes = new Hono()
	.get(
		"/billing/overview",
		doc({
			response: withErrors({ 200: OverviewResponse }),
			detail: detail(
				"Overview billing (MRR + counts)",
				"MRR aggregato e conteggi per stato dei store_subscriptions.",
			),
		}),
		requireAdmin,
		async (c) => send(c, OverviewResponse, ok(await getBillingOverview())),
	)
	.get(
		"/billing/pricing/current",
		doc({
			response: withErrors({ 200: PricingResponse }),
			detail: detail(
				"Pricing config attivo",
				"Restituisce la riga pricing_config con is_active=true.",
			),
		}),
		requireAdmin,
		async (c) => send(c, PricingResponse, ok(await getCurrentPricing())),
	)
	.get(
		"/billing/pricing/history",
		doc({
			response: withErrors({ 200: PricingHistoryResponse }),
			detail: detail(
				"Storico configurazioni pricing",
				"Tutte le righe pricing_config in ordine decrescente.",
			),
		}),
		requireAdmin,
		async (c) =>
			send(c, PricingHistoryResponse, ok(await listPricingHistory())),
	)
	.put(
		"/billing/pricing",
		doc({
			response: withConflictErrors({ 200: UpdatePricingResponse }),
			detail: detail(
				"Aggiorna pricing",
				"Crea un nuovo Stripe Price e flip is_active sulla nuova riga pricing_config.",
			),
		}),
		v("json", UpdatePricingBody),
		requireAdmin,
		async (c) => {
			const data = await updatePricing({
				...c.req.valid("json"),
				adminUserId: c.var.user.id,
			});
			return send(c, UpdatePricingResponse, ok(data));
		},
	)
	.get(
		"/billing/subscriptions",
		doc({
			response: withErrors({ 200: SubscriptionsResponse }),
			detail: detail(
				"Lista subscription (admin)",
				"Tutti gli store_subscriptions con join su store + seller. Filtri opzionali per stato, email, nome.",
			),
		}),
		v("query", SubscriptionsQuery),
		requireAdmin,
		async (c) => {
			const query = c.req.valid("query");
			const data = await listAllSubscriptions({
				page: query.page ?? 1,
				limit: query.limit ?? 25,
				status: query.status,
				sellerEmail: query.sellerEmail,
				storeName: query.storeName,
			});
			return send(c, SubscriptionsResponse, ok(data));
		},
	);
