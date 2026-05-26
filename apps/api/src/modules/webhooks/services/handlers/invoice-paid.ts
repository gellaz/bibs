import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { logger } from "@/lib/logger";

export async function handleInvoicePaid(event: Stripe.Event): Promise<void> {
	const invoice = event.data.object as Stripe.Invoice;

	const subscriptionId = getSubscriptionIdFromInvoice(invoice);
	if (!subscriptionId) {
		logger.info(
			{ invoiceId: invoice.id },
			"Invoice without subscription, skipping",
		);
		return;
	}

	const existing = await db.query.storeSubscription.findFirst({
		where: eq(storeSubscription.stripeSubscriptionId, subscriptionId),
	});
	if (!existing) {
		logger.warn(
			{ stripeSubscriptionId: subscriptionId },
			"invoice.payment_succeeded for unknown sub, skipping",
		);
		return;
	}

	const periodEnd = invoice.lines.data[0]?.period?.end;
	const update: Partial<typeof storeSubscription.$inferInsert> = {
		status: "active",
		suspendedAt: null,
	};
	if (periodEnd) {
		update.currentPeriodEnd = new Date(periodEnd * 1000);
	}

	await db
		.update(storeSubscription)
		.set(update)
		.where(eq(storeSubscription.id, existing.id));
}

function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
	// Stripe v22: subscription ID lives at invoice.parent.subscription_details.subscription
	const fromParent = invoice.parent?.subscription_details?.subscription;
	if (fromParent && typeof fromParent === "string") return fromParent;
	return null;
}
