const toCents = (v: string) => Math.round(Number(v) * 100);

/**
 * Riepilogo in centesimi del dettaglio ordine. `order.total` è la sola merce
 * al netto dei punti: la spedizione vive in `shippingCost` e si somma a parte,
 * quindi lo sconto punti è subtotale − total, senza la spedizione.
 */
export function orderSummaryCents(o: {
	items: { unitPrice: string; quantity: number }[];
	total: string;
	shippingCost: string | null;
	pointsSpent: number;
}) {
	const subtotal = o.items.reduce(
		(s, i) => s + toCents(i.unitPrice) * i.quantity,
		0,
	);
	const total = toCents(o.total);
	const shipping = o.shippingCost ? toCents(o.shippingCost) : 0;
	return {
		subtotal,
		pointsDiscount: o.pointsSpent > 0 ? subtotal - total : 0,
		shipping,
		grandTotal: total + shipping,
	};
}
