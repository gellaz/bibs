import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormSection } from "@/components/form-section";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

const MAX_THRESHOLD = 9999;

function parseThreshold(raw: string): number | null {
	if (!/^\d+$/.test(raw.trim())) return null;
	const n = Number(raw.trim());
	return n <= MAX_THRESHOLD ? n : null;
}

/**
 * Soglia di scorta bassa del negozio: sotto questo stock (escluso) un prodotto
 * attivo compare tra le voci «Da gestire oggi» della home. Salvataggio a sé,
 * sullo stesso PATCH del negozio, per non legarla al form principale (che è
 * condiviso con la creazione del negozio).
 */
export function LowStockThresholdSection({
	storeId,
	value,
}: {
	storeId: string;
	value: number;
}) {
	const qc = useQueryClient();
	const [draft, setDraft] = useState(String(value));
	const parsed = parseThreshold(draft);
	const invalid = parsed === null;

	const save = useMutation({
		mutationFn: async (lowStockThreshold: number) =>
			unwrap(
				await api().seller.stores({ storeId }).patch({ lowStockThreshold }),
				m.store_low_stock_error(),
			).data,
		onSuccess: (store) => {
			setDraft(String(store.lowStockThreshold));
			void qc.invalidateQueries({ queryKey: ["stores"] });
			void qc.invalidateQueries({ queryKey: ["store", storeId] });
			void qc.invalidateQueries({
				queryKey: ["seller", "dashboard", storeId],
			});
			toast.success(m.store_low_stock_saved());
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<FormSection
			title={m.store_low_stock_title()}
			description={m.store_low_stock_description()}
		>
			<form
				className="space-y-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (parsed !== null) save.mutate(parsed);
				}}
			>
				<Label htmlFor="low-stock-threshold">{m.store_low_stock_label()}</Label>
				<div className="flex items-center gap-2">
					<Input
						id="low-stock-threshold"
						type="number"
						inputMode="numeric"
						min={0}
						max={MAX_THRESHOLD}
						step={1}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						aria-invalid={invalid}
						aria-describedby={invalid ? "low-stock-threshold-error" : undefined}
						className="w-24"
					/>
					<Button
						type="submit"
						variant="outline"
						disabled={invalid || parsed === value || save.isPending}
					>
						{m.store_low_stock_save()}
					</Button>
				</div>
				{invalid && (
					<p
						id="low-stock-threshold-error"
						className="text-xs text-destructive"
					>
						{m.store_low_stock_invalid()}
					</p>
				)}
			</form>
		</FormSection>
	);
}
