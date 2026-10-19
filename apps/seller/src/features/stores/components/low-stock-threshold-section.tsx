import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { FormSection } from "@/components/form-section";
import { m } from "@/paraglide/messages";

const MAX_THRESHOLD = 9999;

/** Soglia digitata dal seller: intero da 0 a 9999, altrimenti null. */
export function parseThreshold(raw: string): number | null {
	if (!/^\d+$/.test(raw.trim())) return null;
	const n = Number(raw.trim());
	return n <= MAX_THRESHOLD ? n : null;
}

/**
 * Soglia di scorta bassa del negozio: sotto questo stock (escluso) un prodotto
 * attivo compare tra le voci «Da gestire oggi» della home. Controllata: la
 * salva la scheda Vendita.
 */
export function LowStockThresholdSection({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const invalid = parseThreshold(value) === null;

	return (
		<FormSection
			title={m.store_low_stock_title()}
			description={m.store_low_stock_description()}
		>
			<div className="space-y-2">
				<Label htmlFor="low-stock-threshold">{m.store_low_stock_label()}</Label>
				<Input
					id="low-stock-threshold"
					type="number"
					inputMode="numeric"
					min={0}
					max={MAX_THRESHOLD}
					step={1}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					aria-invalid={invalid}
					aria-describedby={invalid ? "low-stock-threshold-error" : undefined}
					className="w-24"
				/>
				{invalid && (
					<p
						id="low-stock-threshold-error"
						className="text-xs text-destructive"
					>
						{m.store_low_stock_invalid()}
					</p>
				)}
			</div>
		</FormSection>
	);
}
