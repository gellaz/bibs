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
