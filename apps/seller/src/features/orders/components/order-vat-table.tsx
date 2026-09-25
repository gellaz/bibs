import { formatPriceEur } from "@bibs/ui/components/price";
import { m } from "@/paraglide/messages";

type Line = { rate: number; taxableAmount: string; taxAmount: string };

/** Castelletto IVA dell'ordine: unica fonte fiscale (vatBreakdown), mai la
 *  somma delle righe, che è calcolata prima dello sconto punti. */
export function OrderVatTable({ lines }: { lines: Line[] | null }) {
	if (!lines || lines.length === 0)
		return (
			<p className="text-muted-foreground text-sm">
				{m.orders_detail_vat_missing()}
			</p>
		);
	return (
		<table className="w-full text-sm tabular-nums">
			<thead className="text-muted-foreground">
				<tr>
					<th className="py-1 text-left font-medium">
						{m.orders_detail_vat_rate()}
					</th>
					<th className="py-1 text-right font-medium">
						{m.orders_detail_vat_taxable()}
					</th>
					<th className="py-1 text-right font-medium">
						{m.orders_detail_vat_tax()}
					</th>
				</tr>
			</thead>
			<tbody>
				{lines.map((l) => (
					<tr key={l.rate} className="border-border border-t">
						<td className="py-1">{l.rate}%</td>
						<td className="py-1 text-right">
							{formatPriceEur(l.taxableAmount)}
						</td>
						<td className="py-1 text-right">{formatPriceEur(l.taxAmount)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
