// apps/seller/src/features/products/components/stock-editor-cell.tsx
"use no memo";

import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { toast } from "@bibs/ui/components/sonner";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStockAdjustMutation } from "@/features/products/hooks/use-stock-adjust-mutation";
import { m } from "@/paraglide/messages";

interface Props {
	productId: string;
	storeId: string;
	stock: number;
	readOnly?: boolean;
}

const DEBOUNCE_MS = 500;

export function StockEditorCell({
	productId,
	storeId,
	stock,
	readOnly,
}: Props) {
	const { adjust, set } = useStockAdjustMutation();
	const [pendingDelta, setPendingDelta] = useState(0);
	const [editMode, setEditMode] = useState(false);
	const [editValue, setEditValue] = useState("");
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	// Valore visibile: server stock + delta accumulato (a meno che non siamo in edit).
	const optimistic = stock + pendingDelta;

	const flush = (deltaSnapshot: number) => {
		if (deltaSnapshot === 0) {
			setPendingDelta(0);
			return;
		}
		setPendingDelta(0);
		adjust.mutate(
			{ productId, storeId, delta: deltaSnapshot },
			{
				onError: (err: unknown) => {
					const status = (err as { status?: number }).status;
					if (status === 409) {
						toast.error(m.products_stock_error_negative());
					} else if (status === 403) {
						toast.error(m.products_stock_error_no_access());
					} else {
						toast.error((err as Error)?.message || "Errore");
					}
					// rollback: il valore visibile torna a `stock` (canonical via query cache)
				},
			},
		);
	};

	const scheduleFlush = (nextDelta: number) => {
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			flush(nextDelta);
		}, DEBOUNCE_MS);
	};

	useEffect(() => {
		return () => {
			// su unmount, esegui subito il flush in volo
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				if (pendingDelta !== 0) flush(pendingDelta);
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	if (readOnly) {
		return <span className="tabular-nums">{stock}</span>;
	}

	const onIncrement = () => {
		const next = pendingDelta + 1;
		setPendingDelta(next);
		scheduleFlush(next);
	};

	const onDecrement = () => {
		if (optimistic === 0) return;
		const next = pendingDelta - 1;
		setPendingDelta(next);
		scheduleFlush(next);
	};

	const onNumberClick = () => {
		setEditValue(String(optimistic));
		setEditMode(true);
		setTimeout(() => inputRef.current?.select(), 0);
	};

	const commitSet = () => {
		const parsed = Number.parseInt(editValue, 10);
		if (Number.isNaN(parsed) || parsed < 0) {
			setEditMode(false);
			return;
		}
		if (parsed === optimistic) {
			setEditMode(false);
			return;
		}
		setEditMode(false);
		set.mutate(
			{ productId, storeId, stock: parsed },
			{
				onError: (err: unknown) => {
					toast.error((err as Error)?.message || "Errore");
				},
			},
		);
	};

	return (
		<div className="flex items-center gap-1">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="h-7 w-7"
				onClick={onDecrement}
				disabled={adjust.isPending || optimistic === 0}
				aria-label="Diminuisci"
			>
				<MinusIcon className="size-3.5" />
			</Button>
			{editMode ? (
				<Input
					ref={inputRef}
					type="number"
					inputMode="numeric"
					className="h-7 w-14 px-1 text-center tabular-nums"
					value={editValue}
					onChange={(e) => setEditValue(e.target.value)}
					onBlur={commitSet}
					onKeyDown={(e) => {
						if (e.key === "Enter") commitSet();
						else if (e.key === "Escape") setEditMode(false);
					}}
					min={0}
				/>
			) : (
				<button
					type="button"
					onClick={onNumberClick}
					className="hover:bg-accent w-10 rounded px-1 text-center font-medium tabular-nums"
				>
					{optimistic}
				</button>
			)}
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="h-7 w-7"
				onClick={onIncrement}
				disabled={adjust.isPending}
				aria-label="Aumenta"
			>
				<PlusIcon className="size-3.5" />
			</Button>
		</div>
	);
}
