import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { refreshConnectAccount } from "@/modules/billing/services/connect-account";

/**
 * I conti sono creati con Accounts v2, ma Stripe continua a emettere l'evento
 * v1 `account.updated` (scope "Connected accounts") anche per i conti v2: qui
 * serve solo l'id, lo stato vero lo rilegge refreshConnectAccount via
 * `v2.core.accounts.retrieve`. Nessun thin event v2 da gestire.
 */
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
