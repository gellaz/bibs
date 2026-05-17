import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { cn } from "@bibs/ui/lib/utils";
import { m } from "@/paraglide/messages";

export const PERCENT_PRESETS = [5, 10, 15, 20, 25, 50] as const;

interface Props {
	value: number;
	onChange: (next: number) => void;
	disabled?: boolean;
	error?: string;
}

export function DiscountPercentInput({
	value,
	onChange,
	disabled,
	error,
}: Props) {
	const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
	const isPreset = (PERCENT_PRESETS as readonly number[]).includes(safeValue);

	function clampAndSet(next: number) {
		if (!Number.isFinite(next)) return;
		onChange(Math.min(99, Math.max(1, Math.round(next))));
	}

	return (
		<div className="space-y-2">
			<Label>{m.promotions_form_percent_label()}</Label>
			<div className="flex flex-wrap items-center gap-1.5">
				{PERCENT_PRESETS.map((p) => {
					const selected = safeValue === p;
					return (
						<button
							key={p}
							type="button"
							disabled={disabled}
							onClick={() => onChange(p)}
							aria-pressed={selected}
							className={cn(
								"rounded-full px-3 py-1 font-mono text-sm tabular-nums transition-colors",
								selected
									? "bg-blue-500 text-blue-50 hover:bg-blue-500/90 dark:bg-blue-500 dark:text-blue-50"
									: "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
								disabled && "cursor-not-allowed opacity-50",
							)}
						>
							{p}%
						</button>
					);
				})}
				<div className="flex items-center gap-2 pl-1">
					<span className="text-muted-foreground text-xs">
						{m.promotions_form_percent_preset_other()}
					</span>
					<div className="relative">
						<Input
							type="number"
							min={1}
							max={99}
							step={1}
							disabled={disabled}
							value={!isPreset && safeValue > 0 ? safeValue : ""}
							onChange={(e) => {
								const n = Number.parseInt(e.target.value, 10);
								if (Number.isFinite(n)) clampAndSet(n);
							}}
							className={cn(
								"w-20 pr-6 font-mono tabular-nums",
								!isPreset && safeValue > 0 && "ring-2 ring-blue-500/50",
							)}
							placeholder="—"
							aria-label={m.promotions_form_percent_preset_other()}
						/>
						<span className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 text-xs">
							%
						</span>
					</div>
				</div>
			</div>
			{error && <p className="text-destructive text-sm">{error}</p>}
		</div>
	);
}
