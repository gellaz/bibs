import { formatPoints } from "@/features/checkout/points-toggle";
import { m } from "@/paraglide/messages";

/** Totale in centesimi: con i punti un ordine pagato può costare 0 €. */
const toCents = (v: string) => Math.round(Number(v) * 100);

type PaidOrder = { total: string; pointsSpent: number };

/** Testo del dialog di annullo di un ordine già pagato: carta, punti o entrambi. */
export function paidCancelDescription(
	order: PaidOrder,
	formatAmount: (v: string) => string,
): string {
	const points = formatPoints(order.pointsSpent);
	if (toCents(order.total) === 0)
		return m.orders_cancel_points_only_description({ points });
	const amount = formatAmount(order.total);
	return order.pointsSpent > 0
		? m.orders_cancel_paid_points_description({ amount, points })
		: m.orders_cancel_paid_description({ amount });
}

/** Toast dopo l'annullo di un ordine pagato: niente «rimborso» se la carta non c'entra. */
export function paidCancelSuccess(order: PaidOrder): string {
	return toCents(order.total) === 0
		? m.orders_cancel_points_only_success()
		: m.orders_cancel_paid_success();
}
