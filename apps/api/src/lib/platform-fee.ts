import { config } from "@/lib/config";

/**
 * Commissione bibs su un ordine pagato online, in centesimi, calcolata sul
 * lordo (prima dello sconto punti). Le fee Stripe restano a bibs e le copre
 * questa commissione.
 */
export function platformFeeCents(grossCents: number): number {
	return Math.round((grossCents * config.platformFeePercent) / 100);
}

/**
 * Quota del negozio su un PR2: il lordo meno la commissione, come se il
 * cliente non avesse usato punti (lo sconto punti lo copre bibs). Stripe non
 * lascia trasferire, legato a un pagamento, più di quanto è stato pagato: la
 * parte coperta dal pagamento del cliente parte con source_transaction, il
 * resto (la quota punti) esce dal saldo disponibile di bibs.
 */
export function storePayoutSplit(o: {
	totalCents: number;
	pointsDiscountCents: number;
	platformFeeCents: number;
}): { fromCharge: number; fromBalance: number } {
	const payout = Math.max(
		0,
		o.totalCents + o.pointsDiscountCents - o.platformFeeCents,
	);
	const fromCharge = Math.min(o.totalCents, payout);
	return { fromCharge, fromBalance: payout - fromCharge };
}
