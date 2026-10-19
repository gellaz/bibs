import type { StatusTone } from "@bibs/ui/custom/status-badge";
import {
	CircleCheckIcon,
	ListTodoIcon,
	type LucideIcon,
	PlugIcon,
	SearchCheckIcon,
} from "lucide-react";
import { m } from "@/paraglide/messages";
import type { OnlinePaymentsStatus } from "./lib/payments-banner";

// Paraglide genera funzioni per chiave; l'accesso con template literal
// (`m[`payments_status_${status}`]`) non tipizza su un index dinamico, quindi
// si usa una mappa esplicita chiusa sulla union letterale dello stato.
// Toni per il venditore: attivare e completare toccano a lui, la verifica a Stripe.
export const STATUS_BADGE: Record<
	OnlinePaymentsStatus,
	{ tone: StatusTone; icon: LucideIcon; label: () => string }
> = {
	none: { tone: "action", icon: PlugIcon, label: m.payments_status_none },
	incomplete: {
		tone: "action",
		icon: ListTodoIcon,
		label: m.payments_status_incomplete,
	},
	in_review: {
		tone: "waiting",
		icon: SearchCheckIcon,
		label: m.payments_status_in_review,
	},
	enabled: {
		tone: "success",
		icon: CircleCheckIcon,
		label: m.store_order_types_payments_on,
	},
};

export const STATUS_BODY: Record<OnlinePaymentsStatus, () => string> = {
	none: m.payments_none_body,
	incomplete: m.payments_incomplete_body,
	in_review: m.payments_in_review_body,
	enabled: m.payments_enabled_body,
};
