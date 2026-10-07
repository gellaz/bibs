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
		// La prima fattura di un negozio nuovo arriva di solito prima di
		// checkout.session.completed, che crea la riga già active col
		// current_period_end della subscription: niente da recuperare.
		const firstInvoice = invoice.billing_reason === "subscription_create";
		logger[firstInvoice ? "info" : "warn"](
			{ stripeSubscriptionId: subscriptionId, invoiceId: invoice.id },
			firstInvoice
				? "First invoice before checkout.session.completed, row not created yet: skipping"
				: "invoice.payment_succeeded for unknown sub, skipping",
		);
		return;
	}

	const periodEnd = invoice.lines.data[0]?.period?.end;
	// Pagato ma con la cancellazione programmata: resta in cancellazione,
	// come farebbe mapStripeStatus (active + cancel_at_period_end → canceling).
	const update: Partial<typeof storeSubscription.$inferInsert> = {
		status: existing.cancelAtPeriodEnd ? "canceling" : "active",
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
