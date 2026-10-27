import { config } from "@/lib/config";

/** Un importo online che Stripe rifiuterebbe: tra 0,01 € e il minimo (0,50 €).
 *  0 € non lo è: niente da incassare, nessun PaymentIntent. */
export function isBelowOnlineMinimum(cents: number): boolean {
	return cents > 0 && cents < config.stripeMinChargeCents;
}
