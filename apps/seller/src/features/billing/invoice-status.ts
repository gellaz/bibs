import type { StatusTone } from "@bibs/ui/custom/status-badge";
import {
	CircleCheckIcon,
	CircleHelpIcon,
	CircleMinusIcon,
	CircleXIcon,
	FileTextIcon,
	type LucideIcon,
	ReceiptIcon,
} from "lucide-react";
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

const INVOICE_BADGE: Record<string, { tone: StatusTone; icon: LucideIcon }> = {
	open: { tone: "action", icon: ReceiptIcon },
	paid: { tone: "success", icon: CircleCheckIcon },
	draft: { tone: "waiting", icon: FileTextIcon },
	void: { tone: "closed", icon: CircleMinusIcon },
	uncollectible: { tone: "destructive", icon: CircleXIcon },
};

/** Etichetta, tono e icona di una fattura per chi la paga; sconosciuta o assente = chiusa. */
export function invoiceStatusBadge(status: string | null): {
	label: string;
	tone: StatusTone;
	icon: LucideIcon;
} {
	const badge = (status && INVOICE_BADGE[status]) || {
		tone: "closed" as const,
		icon: CircleHelpIcon,
	};
	return { label: invoiceStatusLabel(status), ...badge };
}
