import { config } from "@/lib/config";
import { isBelowOnlineMinimum } from "@/lib/online-charge";

/**
 * Quanti punti usare in un checkout e come dividerli tra i suoi ordini «Paga e
 * ritira», dato il lordo di ciascuno (prima dei punti).
 *
 * 1. Sconto massimo: il saldo in centesimi, plafonato alla somma dei lordi.
 * 2. L'importo online resta 0 € oppure ≥ 0,50 € (minimo Stripe): se il residuo
 *    cadrebbe tra 0,01 e 0,49 € si usano meno punti, quanto basta a lasciare
 *    0,50 €. Con saldo sufficiente il passo 1 dà già 0 €.
 * 3. Lo sconto si ripartisce in proporzione al lordo, resti maggiori al
 *    centesimo (a parità vince l'ordine che viene prima): Σ quote = sconto.
 */
export function allocateCheckoutPoints(input: {
	balance: number;
	grossCents: number[];
}): { discountCents: number[]; points: number[] } {
	const { grossCents } = input;
	const total = grossCents.reduce((s, g) => s + g, 0);
	const balanceCents = Math.floor(
		(input.balance * 100) / config.pointsPerEuroDiscount,
	);

	let discount = Math.min(balanceCents, total);
	const residual = total - discount;
	if (isBelowOnlineMinimum(residual))
		discount = Math.max(0, total - config.stripeMinChargeCents);

	const discountCents = grossCents.map(() => 0);
	if (discount > 0) {
		// Resti interi, non frazioni: due resti uguali devono risultare uguali.
		const shares = grossCents.map((g, i) => {
			const scaled = discount * g;
			const remainder = scaled % total;
			discountCents[i] = (scaled - remainder) / total;
			return { i, remainder };
		});
		let left = discount - discountCents.reduce((s, d) => s + d, 0);
		// Sort stabile: a parità di resto resta l'ordine originale.
		for (const { i } of shares.sort((a, b) => b.remainder - a.remainder)) {
			if (left === 0) break;
			discountCents[i] += 1;
			left -= 1;
		}
	}

	return {
		discountCents,
		points: discountCents.map((d) => (d * config.pointsPerEuroDiscount) / 100),
	};
}
