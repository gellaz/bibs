import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";

/** Separatore delle migliaia sempre: in italiano Intl non raggruppa le cifre
 *  sotto 10.000, e «1240» accanto a «12.400» si legge male. */
export function formatPoints(n: number): string {
	return new Intl.NumberFormat(getLocale(), { useGrouping: true }).format(n);
}

/** «Usa N punti», o «Usa N dei tuoi M» quando il server ne usa meno del saldo. */
export function pointsToggleLabel(
	w: { pointsSpent: number; discount: string },
	balance: number,
): string {
	return w.pointsSpent < balance
		? m.checkout_points_use_some({
				points: formatPoints(w.pointsSpent),
				balance: formatPoints(balance),
			})
		: m.checkout_points_use_all({ points: formatPoints(w.pointsSpent) });
}

/** L'importo online dello scenario scelto dall'interruttore. */
export function amountDueOnline(
	preview: {
		withoutPoints: { amountDueOnline: string };
		withPoints: { amountDueOnline: string } | null;
	},
	usePoints: boolean,
): string {
	return usePoints && preview.withPoints
		? preview.withPoints.amountDueOnline
		: preview.withoutPoints.amountDueOnline;
}

/** L'importo online dello scenario scelto è sotto il minimo Stripe: la
 *  conferma va bloccata. Con i punti accesi l'importo è per costruzione
 *  0 € o almeno il minimo, quindi conta solo lo scenario senza punti. */
export function onlineChargeBlocked(
	preview: {
		withoutPoints: { belowMinimum: boolean };
		withPoints: { amountDueOnline: string } | null;
	},
	usePoints: boolean,
): boolean {
	if (usePoints && preview.withPoints) return false;
	return preview.withoutPoints.belowMinimum;
}
