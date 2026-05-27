import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import {
	type StoreSubscriptionStatus,
	storeSubscription,
} from "@/db/schemas/store-subscription";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { stripe } from "@/lib/stripe";

export interface BillingSubscriptionRow {
	storeId: string;
	storeName: string;
	status: StoreSubscriptionStatus;
	feeAmountCents: number;
	currency: string;
	currentPeriodEnd: Date;
	cancelAtPeriodEnd: boolean;
	suspendedAt: Date | null;
}

const BILLABLE_STATUSES = ["active", "past_due", "canceling"] as const;
const BACKOFFICE_STATUSES = [
	"active",
	"past_due",
	"canceling",
	"suspended",
] as const;

interface SellerScope {
	sellerProfileId: string;
}

export async function getBillingSummary(params: SellerScope) {
	const rows = await db
		.select({
			storeId: storeSubscription.storeId,
			storeName: store.name,
			status: storeSubscription.status,
			feeAmountCents: storeSubscription.feeAmountCents,
			currentPeriodEnd: storeSubscription.currentPeriodEnd,
		})
		.from(storeSubscription)
		.innerJoin(store, eq(storeSubscription.storeId, store.id))
		.where(
			and(
				eq(store.sellerProfileId, params.sellerProfileId),
				isNull(store.deletedAt),
				inArray(storeSubscription.status, [
					...BILLABLE_STATUSES,
				] as unknown as (typeof BILLABLE_STATUSES)[number][]),
			),
		)
		.orderBy(asc(storeSubscription.currentPeriodEnd));

	const totalMonthlyCents = rows.reduce((sum, r) => sum + r.feeAmountCents, 0);
	const activeStoresCount = rows.length;
	const nextRenewal =
		rows.length > 0
			? {
					storeId: rows[0].storeId,
					storeName: rows[0].storeName,
					date: rows[0].currentPeriodEnd,
					amountCents: rows[0].feeAmountCents,
				}
			: null;

	return { totalMonthlyCents, activeStoresCount, nextRenewal };
}

export async function listBillingSubscriptions(
	params: SellerScope,
): Promise<BillingSubscriptionRow[]> {
	return db
		.select({
			storeId: storeSubscription.storeId,
			storeName: store.name,
			status: storeSubscription.status,
			feeAmountCents: storeSubscription.feeAmountCents,
			currency: storeSubscription.currency,
			currentPeriodEnd: storeSubscription.currentPeriodEnd,
			cancelAtPeriodEnd: storeSubscription.cancelAtPeriodEnd,
			suspendedAt: storeSubscription.suspendedAt,
		})
		.from(storeSubscription)
		.innerJoin(store, eq(storeSubscription.storeId, store.id))
		.where(
			and(
				eq(store.sellerProfileId, params.sellerProfileId),
				isNull(store.deletedAt),
				inArray(storeSubscription.status, [
					...BACKOFFICE_STATUSES,
				] as unknown as (typeof BACKOFFICE_STATUSES)[number][]),
			),
		)
		.orderBy(asc(store.name));
}

interface ListInvoicesParams {
	sellerProfileId: string;
	limit: number;
	startingAfter: string | undefined;
}

function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
	// Stripe v22: subscription ID lives at invoice.parent.subscription_details.subscription
	const fromParent = invoice.parent?.subscription_details?.subscription;
	if (fromParent && typeof fromParent === "string") return fromParent;
	return null;
}

export async function listInvoices(params: ListInvoicesParams) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, params.sellerProfileId),
	});
	if (!profile?.stripeCustomerId) {
		throw new ServiceError(404, "Nessun Customer Stripe per questo seller");
	}

	const list = await stripe.invoices.list({
		customer: profile.stripeCustomerId,
		limit: Math.min(params.limit, 100),
		...(params.startingAfter ? { starting_after: params.startingAfter } : {}),
	});

	return {
		data: list.data.map((inv) => ({
			id: inv.id,
			createdAt: new Date(inv.created * 1000),
			amountPaidCents: inv.amount_paid,
			currency: inv.currency.toUpperCase(),
			status: inv.status ?? null,
			invoicePdfUrl: inv.invoice_pdf ?? null,
			stripeSubscriptionId: getSubscriptionIdFromInvoice(inv),
			description: inv.lines.data[0]?.description ?? null,
		})),
		hasMore: list.has_more,
	};
}

export async function createPortalSession(params: {
	sellerProfileId: string;
	stripeCustomerId: string | null;
}): Promise<{ url: string }> {
	if (!params.stripeCustomerId) {
		throw new ServiceError(
			404,
			"Nessun Customer Stripe associato a questo seller",
		);
	}
	const session = await stripe.billingPortal.sessions.create({
		customer: params.stripeCustomerId,
		return_url: `${env.SELLER_APP_URL}/billing`,
	});
	return { url: session.url };
}
