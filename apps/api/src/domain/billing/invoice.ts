import type Stripe from "stripe";

export function getSubscriptionIdFromInvoice(
	invoice: Stripe.Invoice,
): string | null {
	// Stripe v22: subscription ID lives at invoice.parent.subscription_details.subscription
	const fromParent = invoice.parent?.subscription_details?.subscription;
	if (fromParent && typeof fromParent === "string") return fromParent;
	return null;
}
