import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { logger } from "@/lib/logger";

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
	if (existing.status === "active" || existing.status === "canceling") {
		await db
			.update(storeSubscription)
			.set({ status: "past_due" })
			.where(eq(storeSubscription.id, existing.id));
	}
}

function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
	// Stripe v22: subscription ID lives at invoice.parent.subscription_details.subscription
	const fromParent = invoice.parent?.subscription_details?.subscription;
	if (fromParent && typeof fromParent === "string") return fromParent;
	return null;
}
