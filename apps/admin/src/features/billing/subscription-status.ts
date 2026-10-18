import type { StatusTone } from "@bibs/ui/custom/status-badge";
import {
	BanIcon,
	CalendarClockIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleHelpIcon,
	CircleMinusIcon,
	type LucideIcon,
} from "lucide-react";
import { m } from "@/paraglide/messages";

/**
 * Etichetta, tono e icona del badge per lo stato di un abbonamento, letti a
 * ogni chiamata (dopo un cambio di lingua). Toni per l'admin: un abbonamento
 * in cancellazione è già chiuso. Uno stato sconosciuto si mostra grezzo.
 */
export function subscriptionStatusBadge(status: string): {
	label: string;
	tone: StatusTone;
	icon: LucideIcon;
} {
	switch (status) {
		case "active":
			return {
				label: m.billing_status_active(),
				tone: "success",
				icon: CircleCheckIcon,
			};
		case "past_due":
			return {
				label: m.billing_status_past_due(),
				tone: "destructive",
				icon: CircleAlertIcon,
			};
		case "canceling":
			return {
				label: m.billing_status_canceling(),
				tone: "closed",
				icon: CalendarClockIcon,
			};
		case "suspended":
			return {
				label: m.billing_status_suspended(),
				tone: "destructive",
				icon: BanIcon,
			};
		case "canceled":
			return {
				label: m.billing_status_canceled(),
				tone: "closed",
				icon: CircleMinusIcon,
			};
		default:
			return { label: status, tone: "closed", icon: CircleHelpIcon };
	}
}
