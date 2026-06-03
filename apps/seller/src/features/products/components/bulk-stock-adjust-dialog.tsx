import { Button } from "@bibs/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { toast } from "@bibs/ui/components/sonner";
import { Tabs, TabsList, TabsTrigger } from "@bibs/ui/components/tabs";
import {
	EqualIcon,
	MinusIcon,
	PlusIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBulkStockAdjustMutation } from "@/features/products/hooks/use-bulk-stock-adjust-mutation";
import { useActiveStore } from "@/hooks/use-active-store";
import { m } from "@/paraglide/messages";

type Mode = "delta-add" | "delta-sub" | "set";

const LIMITS: Record<Mode, { min: number; max: number }> = {
	"delta-add": { min: 1, max: 1000 },
	"delta-sub": { min: 1, max: 1000 },
	set: { min: 0, max: 100000 },
};

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	productIds: string[];
	storeId: string;
	onSuccess: () => void;
}

export function BulkStockAdjustDialog({
	open,
	onOpenChange,
	productIds,
	storeId,
	onSuccess,
}: Props) {
	const { activeStore } = useActiveStore();
	const [mode, setMode] = useState<Mode>("delta-add");
	const [value, setValue] = useState("1");
	const inputRef = useRef<HTMLInputElement>(null);

	const mutation = useBulkStockAdjustMutation();

	// Reset all'apertura (copre anche l'annulla), non dopo il successo.
	useEffect(() => {
		if (open) {
			setMode("delta-add");
			setValue("1");
		}
	}, [open]);

	const { min, max } = LIMITS[mode];
	const parsed = Number.parseInt(value, 10);
	const valueValid = !Number.isNaN(parsed) && parsed >= min && parsed <= max;

	const showZeroWarning = mode === "set" && parsed === 0;

	const step = (delta: number) => {
		const base = Number.isNaN(parsed) ? min : parsed;
		const next = Math.min(max, Math.max(min, base + delta));
		setValue(String(next));
		inputRef.current?.focus();
	};

	const onModeChange = (next: Mode) => {
		setMode(next);
		// Il valore corrente può uscire dal range del nuovo mode (es. 0 con
		// "Sottrai"): riallinealo al minimo invece di lasciare il form invalido.
		const limits = LIMITS[next];
		if (Number.isNaN(parsed) || parsed < limits.min) {
			setValue(String(limits.min));
		}
	};

	const effectLine = !valueValid
		? m.products_bulk_adjust_range_hint({ min, max })
		: mode === "delta-add"
			? m.products_bulk_adjust_effect_add({ value: parsed })
			: mode === "delta-sub"
				? m.products_bulk_adjust_effect_sub({ value: parsed })
				: m.products_bulk_adjust_effect_set({ value: parsed });

	const confirmLabel =
		mode === "delta-add"
			? m.products_bulk_adjust_tab_add()
			: mode === "delta-sub"
				? m.products_bulk_adjust_tab_sub()
				: m.products_bulk_adjust_tab_set();

	const onSubmit = () => {
		if (!valueValid) return;
		const body =
			mode === "delta-add"
				? { mode: "delta" as const, value: parsed }
				: mode === "delta-sub"
					? { mode: "delta" as const, value: -parsed }
					: { mode: "set" as const, value: parsed };

		mutation.mutate(
			{ storeId, productIds, ...body },
			{
				onSuccess: (result) => {
					if (result.failed.length === 0) {
						toast.success(
							m.products_bulk_adjust_success({
								count: result.succeeded.length,
							}),
						);
					} else {
						const neg = result.failed.filter(
							(f) => f.reason === "would_go_negative",
						).length;
						const nf = result.failed.filter(
							(f) => f.reason === "not_found",
						).length;
						const parts: string[] = [];
						if (neg > 0) parts.push(`${neg} stock insufficiente`);
						if (nf > 0) parts.push(`${nf} non disponibili`);
						toast.warning(
							m.products_bulk_adjust_partial_warning({
								ok: result.succeeded.length,
								failed: result.failed.length,
								breakdown: parts.join(", "),
							}),
						);
					}
					onSuccess();
					onOpenChange(false);
				},
				onError: () => toast.error(m.products_bulk_adjust_error()),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-sm"
				onOpenAutoFocus={(e) => {
					// Il focus di default andrebbe sul primo tab: meglio partire
					// dalla quantità, già selezionata per sovrascriverla al volo.
					e.preventDefault();
					inputRef.current?.select();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{m.products_bulk_adjust_dialog_title({
							count: productIds.length,
						})}
					</DialogTitle>
					{activeStore && (
						<DialogDescription>
							{m.products_bulk_adjust_dialog_subtitle({
								storeName: activeStore.name,
							})}
						</DialogDescription>
					)}
				</DialogHeader>

				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						onSubmit();
					}}
				>
					<Tabs value={mode} onValueChange={(v) => onModeChange(v as Mode)}>
						<TabsList className="grid w-full grid-cols-3">
							<TabsTrigger value="delta-add">
								<PlusIcon />
								{m.products_bulk_adjust_tab_add()}
							</TabsTrigger>
							<TabsTrigger value="delta-sub">
								<MinusIcon />
								{m.products_bulk_adjust_tab_sub()}
							</TabsTrigger>
							<TabsTrigger value="set">
								<EqualIcon />
								{m.products_bulk_adjust_tab_set()}
							</TabsTrigger>
						</TabsList>
					</Tabs>

					{/* Stesso vocabolario dello stepper nella colonna Stock della
					    tabella, in formato grande da dialogo. */}
					<div className="border-input bg-background mx-auto flex h-11 w-fit items-stretch overflow-hidden rounded-lg border shadow-xs">
						<button
							type="button"
							onClick={() => step(-1)}
							disabled={
								mutation.isPending || (!Number.isNaN(parsed) && parsed <= min)
							}
							aria-label={m.products_stock_decrement_aria()}
							className="text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/70 border-input focus-visible:ring-ring/50 flex w-11 items-center justify-center border-r transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40"
						>
							<MinusIcon className="size-4" />
						</button>
						<input
							ref={inputRef}
							inputMode="numeric"
							pattern="[0-9]*"
							value={value}
							onChange={(e) =>
								setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
							}
							onFocus={(e) => e.currentTarget.select()}
							disabled={mutation.isPending}
							aria-label={m.products_bulk_adjust_field_quantity()}
							className="caret-ring w-24 bg-transparent text-center text-lg font-semibold tabular-nums outline-none disabled:cursor-not-allowed"
						/>
						<button
							type="button"
							onClick={() => step(1)}
							disabled={
								mutation.isPending || (!Number.isNaN(parsed) && parsed >= max)
							}
							aria-label={m.products_stock_increment_aria()}
							className="text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/70 border-input focus-visible:ring-ring/50 flex w-11 items-center justify-center border-l transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40"
						>
							<PlusIcon className="size-4" />
						</button>
					</div>

					<p
						className={
							valueValid
								? "text-muted-foreground text-center text-sm text-balance"
								: "text-destructive text-center text-sm text-balance"
						}
					>
						{effectLine}
					</p>

					{showZeroWarning && (
						<div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
							<TriangleAlertIcon
								aria-hidden
								className="text-warning mt-0.5 size-4 shrink-0"
							/>
							<span>
								{m.products_bulk_adjust_warning_zero({
									count: productIds.length,
								})}
							</span>
						</div>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							{m.common_cancel()}
						</Button>
						<Button type="submit" disabled={!valueValid || mutation.isPending}>
							{confirmLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
