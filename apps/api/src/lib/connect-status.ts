import type Stripe from "stripe";

export type ConnectStatus = "none" | "incomplete" | "in_review" | "enabled";

/**
 * Stato del conto Connect come lo vede il seller. `charges_enabled` vince su
 * tutto: è l'unico flag che rende PR2 attivabile.
 */
export function connectStatus(
	pm:
		| {
				stripeAccountId: string | null;
				detailsSubmitted: boolean;
				chargesEnabled: boolean;
		  }
		| null
		| undefined,
): ConnectStatus {
	if (!pm?.stripeAccountId) return "none";
	if (pm.chargesEnabled) return "enabled";
	return pm.detailsSubmitted ? "in_review" : "incomplete";
}

export interface ConnectAccountState {
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	detailsSubmitted: boolean;
}

/**
 * Proietta un conto Accounts v2 (configurazione `recipient`) sulle tre colonne
 * di payment_methods. Il conto va letto con
 * `include: ["configuration.recipient", "requirements"]`, altrimenti Stripe
 * restituisce quei campi a null e qui diventano tutti false.
 *
 * - `chargesEnabled`: bibs può trasferirgli fondi (`stripe_transfers` attivo).
 * - `payoutsEnabled`: può versare sul proprio IBAN.
 * - `detailsSubmitted`: nessun requisito aspetta un'azione del seller; quelli
 *   che aspettano Stripe (verifica in corso) non contano, così `in_review`
 *   significa "tocca a Stripe" e `incomplete` "tocca al seller".
 */
export function accountStateFromV2(
	account: Stripe.V2.Core.Account,
): ConnectAccountState {
	const balance =
		account.configuration?.recipient?.capabilities?.stripe_balance;
	const entries = account.requirements?.entries;
	return {
		chargesEnabled: balance?.stripe_transfers?.status === "active",
		payoutsEnabled: balance?.payouts?.status === "active",
		detailsSubmitted:
			account.requirements != null &&
			!(entries ?? []).some((e) => e.awaiting_action_from === "user"),
	};
}
