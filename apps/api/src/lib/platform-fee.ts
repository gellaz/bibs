import { config } from "@/lib/config";

/**
 * Commissione bibs su un ordine pagato online, in centesimi. Le fee Stripe
 * restano a bibs e le copre questa commissione.
 */
export function platformFeeCents(totalCents: number): number {
	return Math.round((totalCents * config.platformFeePercent) / 100);
}
