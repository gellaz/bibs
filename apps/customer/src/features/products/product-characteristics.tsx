import { m } from "@/paraglide/messages";
import { characteristicRows } from "./format-characteristic";
import type { ProductCharacteristicView } from "./product-detail-api";

/**
 * Solo le voci valorizzate: il formattatore scarta ciò che non si può
 * mostrare, e senza righe la sezione non esiste (nemmeno il titolo).
 * Tabella vera, con l'intestazione di riga: uno screen reader legge
 * «Peso, 250 g» come coppia.
 */
export function ProductCharacteristics({
	characteristics,
}: {
	characteristics: ProductCharacteristicView[];
}) {
	const rows = characteristicRows(characteristics, {
		yes: m.product_detail_yes(),
		no: m.product_detail_no(),
	});
	if (rows.length === 0) return null;

	return (
		<section
			aria-labelledby="product-characteristics-title"
			className="space-y-3"
		>
			<h2
				id="product-characteristics-title"
				className="font-display font-semibold text-foreground text-lg"
			>
				{m.product_detail_characteristics_title()}
			</h2>
			<table className="w-full table-fixed border-collapse text-sm">
				<tbody>
					{rows.map((row) => (
						<tr key={row.id} className="border-border border-b last:border-b-0">
							<th
								scope="row"
								className="w-2/5 break-words py-2.5 pr-4 text-left align-top font-normal text-muted-foreground [overflow-wrap:anywhere]"
							>
								{row.name}
							</th>
							<td className="py-2.5 align-top text-foreground break-words [overflow-wrap:anywhere]">
								{row.value}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}
