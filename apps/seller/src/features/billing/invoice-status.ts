import { m } from "@/paraglide/messages";

/**
 * Etichetta dello stato di una fattura Stripe nella lingua corrente, letta a
 * ogni chiamata. Uno stato che Stripe aggiungesse in futuro si mostra grezzo,
 * l'assenza di stato come «—».
 */
export function invoiceStatusLabel(status: string | null): string {
	switch (status) {
		case null:
			return "—";
		case "paid":
			return m.billing_invoice_status_paid();
		case "open":
			return m.billing_invoice_status_open();
		case "void":
			return m.billing_invoice_status_void();
		case "uncollectible":
			return m.billing_invoice_status_uncollectible();
		case "draft":
			return m.billing_invoice_status_draft();
		default:
			return status;
	}
}
