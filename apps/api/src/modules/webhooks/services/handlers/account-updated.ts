import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { refreshConnectAccount } from "@/modules/billing/services/connect-account";

/**
 * I conti sono creati con Accounts v2, ma Stripe continua a emettere gli
 * eventi v1 `account.updated` e `capability.updated` (scope "Connected
 * accounts") anche per i conti v2: qui serve solo l'id, lo stato vero lo
 * rilegge refreshConnectAccount via `v2.core.accounts.retrieve`. Nessun thin
 * event v2 da gestire.
 */
export async function handleConnectAccountEvent(
	event: Stripe.Event,
): Promise<void> {
	const accountId = connectAccountId(event);
	if (!accountId) {
		logger.warn(
			{ eventId: event.id, type: event.type },
			"Connect event without an account id, skipping",
		);
		return;
	}

	const row = await refreshConnectAccount(accountId);
	if (!row) {
		logger.warn(
			{ eventId: event.id, type: event.type, stripeAccountId: accountId },
			"Connect event for unknown connected account, skipping",
		);
	}
}

/**
 * `account.updated` porta l'Account come data.object. `capability.updated`
 * porta una Capability, che referenzia il conto in `account`: preferiamo
 * `event.account` (valorizzato da Stripe su questi eventi) e usiamo il campo
 * della Capability solo come fallback.
 */
function connectAccountId(event: Stripe.Event): string | undefined {
	if (event.type === "capability.updated") {
		if (typeof event.account === "string") return event.account;
		const capability = event.data.object as Stripe.Capability;
		return typeof capability.account === "string"
			? capability.account
			: undefined;
	}
	return (event.data.object as Stripe.Account).id;
}
