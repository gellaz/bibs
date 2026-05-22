import { Button } from "@bibs/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { Tabs, TabsList, TabsTrigger } from "@bibs/ui/components/tabs";
import { useState } from "react";
import { useBulkStockAdjustMutation } from "@/features/products/hooks/use-bulk-stock-adjust-mutation";
import { useActiveStore } from "@/hooks/use-active-store";
import { m } from "@/paraglide/messages";

type Mode = "delta-add" | "delta-sub" | "set";

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

	const mutation = useBulkStockAdjustMutation();

	const parsed = Number.parseInt(value, 10);
	const valueValid =
		!Number.isNaN(parsed) &&
		(mode === "set"
			? parsed >= 0 && parsed <= 100000
			: parsed >= 1 && parsed <= 1000);

	const showZeroWarning = mode === "set" && parsed === 0;

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
					setValue("1");
					setMode("delta-add");
				},
				onError: () => toast.error(m.products_bulk_adjust_error()),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
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

				<div className="space-y-4">
					<Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
						<TabsList className="grid w-full grid-cols-3">
							<TabsTrigger value="delta-add">
								{m.products_bulk_adjust_tab_add()}
							</TabsTrigger>
							<TabsTrigger value="delta-sub">
								{m.products_bulk_adjust_tab_sub()}
							</TabsTrigger>
							<TabsTrigger value="set">
								{m.products_bulk_adjust_tab_set()}
							</TabsTrigger>
						</TabsList>
					</Tabs>

					<div className="space-y-1">
						<Label htmlFor="bulk-value">
							{m.products_bulk_adjust_field_quantity()}
						</Label>
						<Input
							id="bulk-value"
							type="number"
							inputMode="numeric"
							min={mode === "set" ? 0 : 1}
							max={mode === "set" ? 100000 : 1000}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							className="w-32"
						/>
					</div>

					{showZeroWarning && (
						<div className="rounded-md border border-amber-200 bg-amber-100 px-3 py-2 text-sm text-amber-900">
							{m.products_bulk_adjust_warning_zero({
								count: productIds.length,
							})}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{m.common_cancel()}
					</Button>
					<Button
						onClick={onSubmit}
						disabled={!valueValid || mutation.isPending}
					>
						{m.common_confirm()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
