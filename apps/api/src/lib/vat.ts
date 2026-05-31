import { fromCents } from "@/lib/money";

/**
 * Aliquote IVA italiane gestite, come stringhe percentuali. Default-first ("22").
 * Fonte di verità per l'enum colonna `products.vat_rate` /
 * `product_macro_categories.suggested_vat_rate` e per le union TypeBox.
 */
export const VAT_RATES = ["22", "10", "5", "4", "0"] as const;
export type VatRate = (typeof VAT_RATES)[number];
export const DEFAULT_VAT_RATE: VatRate = "22";

/**
 * Scorpora l'IVA da un importo LORDO in centesimi a una data aliquota intera.
 * netCents arrotondato half-up (gli importi sono non negativi → Math.round),
 * vatCents = lordo − netto così che net + vat == gross esatto.
 */
export function scorporo(
	grossCents: number,
	rate: number,
): { netCents: number; vatCents: number } {
	const netCents = Math.round((grossCents * 100) / (100 + rate));
	return { netCents, vatCents: grossCents - netCents };
}

export interface CastellettoLine {
	rate: number;
	/** Imponibile (netto) in formato decimale, es. "20.00". */
	taxableAmount: string;
	/** Imposta (IVA) in formato decimale, es. "4.40". */
	taxAmount: string;
}

/**
 * Costruisce il castelletto IVA: aggrega il lordo per aliquota, poi scorpora UNA
 * volta per aliquota sull'aggregato (regola riepilogo fattura elettronica), così
 * non accumula errori di arrotondamento riga per riga. Ordina per aliquota desc.
 */
export function buildCastelletto(
	lines: { grossCents: number; rate: number }[],
): CastellettoLine[] {
	const grossByRate = new Map<number, number>();
	for (const l of lines) {
		grossByRate.set(l.rate, (grossByRate.get(l.rate) ?? 0) + l.grossCents);
	}
	return [...grossByRate.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([rate, grossCents]) => {
			const { netCents, vatCents } = scorporo(grossCents, rate);
			return {
				rate,
				taxableAmount: fromCents(netCents),
				taxAmount: fromCents(vatCents),
			};
		});
}
