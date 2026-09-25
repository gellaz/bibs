import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { refreshConnectAccount } from "@/modules/billing/services/connect-account";

export async function handleAccountUpdated(event: Stripe.Event): Promise<void> {
	const account = event.data.object as Stripe.Account;
	const row = await refreshConnectAccount(account.id);
	if (!row) {
		logger.warn(
			{ eventId: event.id, stripeAccountId: account.id },
			"account.updated for unknown connected account, skipping",
		);
	}
}
