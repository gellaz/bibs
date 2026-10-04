import type { ComponentProps } from "react";

import { intlLocale } from "~/lib/intl-locale";
import { cn } from "~/lib/utils";

const EUR_FORMATTERS = new Map<string, Intl.NumberFormat>();

function eurFormatter(locale: string): Intl.NumberFormat {
	let formatter = EUR_FORMATTERS.get(locale);
	if (!formatter) {
		formatter = new Intl.NumberFormat(locale, {
			style: "currency",
			currency: "EUR",
		});
		EUR_FORMATTERS.set(locale, formatter);
	}
	return formatter;
}

/**
 * Formatta un prezzo EUR nella lingua dell'utente: "9,99 €" in italiano,
 * "€9.99" in inglese. Accetta string (es. "9.99" dall'API) o number. Valori
 * non finiti → "—".
 */
export function formatPriceEur(value: string | number): string {
	const n = typeof value === "string" ? Number.parseFloat(value) : value;
	if (!Number.isFinite(n)) return "—";
	return eurFormatter(intlLocale()).format(n);
}

/**
 * Scorporo IVA *indicativo* per la sola visualizzazione (float). Da un prezzo
 * LORDO (IVA inclusa) e un'aliquota intera, ritorna netto (imponibile) e IVA.
 * NON è la fonte fiscale: il calcolo autoritativo è server-side in
 * apps/api/src/lib/vat.ts (centesimi, half-up) e può differire di un centesimo.
 * Usalo solo per anteprime UI. Ritorna NaN se il lordo non è finito.
 */
export function scorporoDisplay(
	gross: string | number,
	rate: number,
): { net: number; vat: number } {
	const g = typeof gross === "string" ? Number.parseFloat(gross) : gross;
	if (!Number.isFinite(g)) return { net: Number.NaN, vat: Number.NaN };
	const net = g / (1 + rate / 100);
	return { net, vat: g - net };
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
