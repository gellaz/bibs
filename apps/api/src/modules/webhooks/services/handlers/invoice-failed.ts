import { and, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { logger } from "@/lib/logger";
import { notifyPaymentFailed } from "../billing-notifications";

export async function handleInvoiceFailed(event: Stripe.Event): Promise<void> {
	const invoice = event.data.object as Stripe.Invoice;

	const subscriptionId = getSubscriptionIdFromInvoice(invoice);
	if (!subscriptionId) return;

	const existing = await db.query.storeSubscription.findFirst({
		where: eq(storeSubscription.stripeSubscriptionId, subscriptionId),
	});
	if (!existing) {
		logger.warn(
			{ stripeSubscriptionId: subscriptionId },
			"invoice.payment_failed for unknown sub, skipping",
		);
		return;
	}

	// Only flip to past_due from healthy states; if already past_due/suspended/canceling,
	// the canonical state comes from customer.subscription.updated.
	// Guarded (CAS) so only the delivery that actually performs the transition
	// sends the dunning email: Stripe retries fail again while already past_due,
	// and those retries must not spam the seller.
	const [transitioned] = await db
		.update(storeSubscription)
		.set({ status: "past_due" })
		.where(
			and(
				eq(storeSubscription.id, existing.id),
				inArray(storeSubscription.status, ["active", "canceling"]),
			),
		)
		.returning({ storeId: storeSubscription.storeId });

	if (transitioned) {
		await notifyPaymentFailed({
			storeId: transitioned.storeId,
			amountCents: invoice.amount_due,
			currency: invoice.currency ?? existing.currency,
		});
	}
}

function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
	// Stripe v22: subscription ID lives at invoice.parent.subscription_details.subscription
	const fromParent = invoice.parent?.subscription_details?.subscription;
	if (fromParent && typeof fromParent === "string") return fromParent;
	return null;
}
