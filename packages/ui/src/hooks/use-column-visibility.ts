"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface TableColumnDef<TId extends string = string> {
	/** Stable identifier of the column. Used both as React key and storage key. */
	id: TId;
	/** Human-readable label shown in the menu. Italian, sentence case. */
	label: string;
	/** When `true` the column cannot be hidden. Default `false`. */
	locked?: boolean;
	/** Initial visibility before the user has expressed a preference. Default `true`. */
	defaultVisible?: boolean;
	/**
	 * Optional grouping hint surfaced in the menu as a section label.
	 * Columns sharing the same group are rendered contiguously, with the
	 * group label printed above the first item of each group.
	 */
	group?: string;
}

export interface ColumnVisibility<TId extends string = string> {
	columns: ReadonlyArray<TableColumnDef<TId>>;
	isVisible: (id: TId) => boolean;
	toggle: (id: TId) => void;
	setVisible: (id: TId, visible: boolean) => void;
	reset: () => void;
	hideableCount: number;
	visibleCount: number;
}

interface UseColumnVisibilityParams<TId extends string> {
	/**
	 * Unique storage key for this table's preference. Conventionally
	 * `"<app>.<surface>.columns"` (e.g. `"seller.products.columns"`).
	 */
	storageKey: string;
	columns: ReadonlyArray<TableColumnDef<TId>>;
}

function buildDefaults<TId extends string>(
	columns: ReadonlyArray<TableColumnDef<TId>>,
): Record<string, boolean> {
	const out: Record<string, boolean> = {};
	for (const col of columns) {
		out[col.id] = col.locked ? true : (col.defaultVisible ?? true);
	}
	return out;
}

/**
 * Track which columns of a data table are currently visible. Defaults come
 * from the column config; user choices persist in `localStorage` under
 * `storageKey`. Locked columns always report visible regardless of stored state.
 *
 * SSR-safe: initial render uses the defaults; stored state is hydrated in
 * an effect to avoid hydration mismatches.
 */
export function useColumnVisibility<TId extends string>({
	storageKey,
	columns,
}: UseColumnVisibilityParams<TId>): ColumnVisibility<TId> {
	const defaults = useMemo(() => buildDefaults(columns), [columns]);
	const [state, setState] = useState<Record<string, boolean>>(defaults);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			const raw = window.localStorage.getItem(storageKey);
			if (raw) {
				const parsed = JSON.parse(raw) as unknown;
				if (parsed && typeof parsed === "object") {
					const next = { ...defaults };
					for (const col of columns) {
						if (col.locked) continue;
						const v = (parsed as Record<string, unknown>)[col.id];
						if (typeof v === "boolean") next[col.id] = v;
					}
					setState(next);
				}
			}
		} catch {
			// Storage disabled / quota / JSON parse: fall back to defaults.
		}
		setHydrated(true);
		// We intentionally rehydrate when the storage key changes (different table),
		// not on every column reference change.
	}, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!hydrated) return;
		if (typeof window === "undefined") return;
		try {
			const toSave: Record<string, boolean> = {};
			for (const col of columns) {
				if (col.locked) continue;
				toSave[col.id] = state[col.id] ?? col.defaultVisible ?? true;
			}
			window.localStorage.setItem(storageKey, JSON.stringify(toSave));
		} catch {
			// Ignore persistence failures.
		}
	}, [state, hydrated, storageKey, columns]);

	const isVisible = useCallback(
		(id: TId) => {
			const col = columns.find((c) => c.id === id);
			if (col?.locked) return true;
			return state[id] ?? col?.defaultVisible ?? true;
		},
		[state, columns],
	);

	const setVisible = useCallback((id: TId, visible: boolean) => {
		setState((prev) => ({ ...prev, [id]: visible }));
	}, []);

	const toggle = useCallback(
		(id: TId) => {
			const col = columns.find((c) => c.id === id);
			if (col?.locked) return;
			setState((prev) => ({
				...prev,
				[id]: !(prev[id] ?? col?.defaultVisible ?? true),
			}));
		},
		[columns],
	);

	const reset = useCallback(() => {
		setState(buildDefaults(columns));
	}, [columns]);

	const hideableCount = useMemo(
		() => columns.filter((c) => !c.locked).length,
		[columns],
	);

	const visibleCount = useMemo(
		() => columns.reduce((n, c) => n + (isVisible(c.id) ? 1 : 0), 0),
		[columns, isVisible],
	);

	return {
		columns,
		isVisible,
		toggle,
		setVisible,
		reset,
		hideableCount,
		visibleCount,
	};
}
