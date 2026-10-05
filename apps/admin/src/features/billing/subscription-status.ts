import { m } from "@/paraglide/messages";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/**
 * Etichetta e variante del badge per lo stato di un abbonamento, lette a ogni
 * chiamata (dopo un cambio di lingua). Stesse etichette e varianti del seller;
 * uno stato sconosciuto si mostra grezzo.
 */
export function subscriptionStatusBadge(status: string): {
	label: string;
	variant: BadgeVariant;
} {
	switch (status) {
		case "active":
			return { label: m.billing_status_active(), variant: "default" };
		case "past_due":
			return { label: m.billing_status_past_due(), variant: "destructive" };
		case "canceling":
			return { label: m.billing_status_canceling(), variant: "outline" };
		case "suspended":
			return { label: m.billing_status_suspended(), variant: "destructive" };
		case "canceled":
			return { label: m.billing_status_canceled(), variant: "secondary" };
		default:
			return { label: status, variant: "outline" };
	}
}
