"use no memo";

import { toast } from "@bibs/ui/components/sonner";
import { ApiError } from "@bibs/ui/lib/api-error";
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

function errorMessage(err: unknown) {
	return err instanceof Error && err.message ? err.message : "Errore";
}

export function StockEditorCell({
	productId,
	storeId,
	stock,
	readOnly,
}: Props) {
	const { adjust, set } = useStockAdjustMutation();
	const [pendingDelta, setPendingDelta] = useState(0);
	// Delta already sent but not yet confirmed: keeps the optimistic value
	// steady while the request is in flight (the `stock` prop is still old).
	const [inFlightDelta, setInFlightDelta] = useState(0);
	// The in-flight adjust, so an absolute set waits for it instead of racing it.
	const inFlightRef = useRef<Promise<unknown> | null>(null);
	const [focused, setFocused] = useState(false);
	const [editValue, setEditValue] = useState(String(stock));
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Tracks the live pendingDelta for the unmount-flush closure ([] effect captures stale state).
	const pendingDeltaRef = useRef(0);
	// Prevents commitSet from firing twice when Enter triggers both onKeyDown and onBlur.
	const committingRef = useRef(false);

	const optimistic = stock + inFlightDelta + pendingDelta;

	// Sync the input with the optimistic value whenever the field isn't being edited.
	useEffect(() => {
		if (!focused) setEditValue(String(optimistic));
	}, [optimistic, focused]);

	const flush = (deltaSnapshot: number) => {
		if (deltaSnapshot === 0) return;
		setPendingDelta(0);
		pendingDeltaRef.current = 0;
		setInFlightDelta((d) => d + deltaSnapshot);
		const request = adjust
			.mutateAsync({ productId, storeId, delta: deltaSnapshot })
			.catch((err: unknown) => {
				const status = err instanceof ApiError ? err.status : undefined;
				if (status === 409) {
					toast.error(m.products_stock_error_negative());
				} else if (status === 403) {
					toast.error(m.products_stock_error_no_access());
				} else {
					toast.error(errorMessage(err));
				}
			})
			.finally(() => {
				if (inFlightRef.current === request) inFlightRef.current = null;
				// Drop the delta only after TanStack Query's cache notification
				// (batched on a 0 ms timeout) has delivered the new `stock`,
				// otherwise the old value flashes for a frame.
				setTimeout(() => setInFlightDelta((d) => d - deltaSnapshot), 0);
			});
		inFlightRef.current = request;
	};

	const scheduleFlush = (nextDelta: number) => {
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			flush(nextDelta);
		}, DEBOUNCE_MS);
	};

	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				if (pendingDeltaRef.current !== 0) flush(pendingDeltaRef.current);
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
		pendingDeltaRef.current = next;
		scheduleFlush(next);
	};

	const onDecrement = () => {
		if (optimistic === 0) return;
		const next = pendingDelta - 1;
		setPendingDelta(next);
		pendingDeltaRef.current = next;
		scheduleFlush(next);
	};

	const commitSet = () => {
		if (committingRef.current) return;
		committingRef.current = true;
		try {
			const parsed = Number.parseInt(editValue, 10);
			if (Number.isNaN(parsed) || parsed < 0) {
				setEditValue(String(optimistic));
				return;
			}
			if (parsed === optimistic) {
				setEditValue(String(optimistic));
				return;
			}
			// Reset pendingDelta: set.mutate sends an absolute value so any accumulated
			// stepper delta is superseded by the explicit value the user typed.
			setPendingDelta(0);
			pendingDeltaRef.current = 0;
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			// An absolute value sent while an adjust is in flight could land
			// before it and get the delta applied on top: wait for it first.
			const pending = inFlightRef.current ?? Promise.resolve();
			void pending.then(() =>
				set.mutate(
					{ productId, storeId, stock: parsed },
					{ onError: (err: unknown) => toast.error(errorMessage(err)) },
				),
			);
		} finally {
			committingRef.current = false;
		}
	};

	const busy = adjust.isPending || set.isPending;

	return (
		<div
			data-slot="stock-stepper"
			className="border-input bg-background focus-within:border-ring focus-within:ring-ring/50 inline-flex h-8 items-stretch overflow-hidden rounded-lg border transition-[box-shadow,border-color] focus-within:ring-3"
		>
			<button
				type="button"
				onClick={onDecrement}
				disabled={busy || optimistic === 0}
				aria-label={m.products_stock_decrement_aria()}
				className="text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/70 border-input flex w-8 items-center justify-center border-r outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
			>
				<MinusIcon className="size-3.5" />
			</button>
			<input
				type="text"
				inputMode="numeric"
				pattern="[0-9]*"
				value={editValue}
				onChange={(e) =>
					setEditValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
				}
				onFocus={(e) => {
					setFocused(true);
					setEditValue(String(optimistic));
					e.currentTarget.select();
				}}
				onBlur={() => {
					setFocused(false);
					commitSet();
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.currentTarget.blur();
					} else if (e.key === "Escape") {
						setEditValue(String(optimistic));
						setFocused(false);
						e.currentTarget.blur();
					}
				}}
				disabled={busy}
				aria-label={m.products_stock_input_aria()}
				className="caret-ring w-12 bg-transparent px-1 text-center text-sm font-medium tabular-nums outline-none disabled:cursor-not-allowed"
			/>
			<button
				type="button"
				onClick={onIncrement}
				disabled={busy}
				aria-label={m.products_stock_increment_aria()}
				className="text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/70 border-input flex w-8 items-center justify-center border-l outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
			>
				<PlusIcon className="size-3.5" />
			</button>
		</div>
	);
}
