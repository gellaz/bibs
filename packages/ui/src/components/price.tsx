import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

const EUR_FORMATTER = new Intl.NumberFormat("it-IT", {
	style: "currency",
	currency: "EUR",
});

/**
 * Formatta un prezzo EUR secondo convenzione italiana: "9,99 €", "1.234,50 €".
 * Accetta string (es. "9.99" dall'API) o number. Valori non finiti → "—".
 */
export function formatPriceEur(value: string | number): string {
	const n = typeof value === "string" ? Number.parseFloat(value) : value;
	if (!Number.isFinite(n)) return "—";
	return EUR_FORMATTER.format(n);
}

interface PriceProps extends Omit<ComponentProps<"span">, "children"> {
	/** Prezzo (string come arriva dall'API, o number). */
	value: string | number;
}

/**
 * Rende un prezzo EUR formattato in stile italiano con `tabular-nums` per
 * mantenere l'allineamento delle cifre quando i prezzi sono incolonnati
 * (tabelle, ricevute, totali ordine).
 */
export function Price({ value, className, ...props }: PriceProps) {
	return (
		<span className={cn("tabular-nums", className)} {...props}>
			{formatPriceEur(value)}
		</span>
	);
}
