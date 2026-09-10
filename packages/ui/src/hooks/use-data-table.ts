"use client";

import {
	type ColumnVisibilityState,
	type OnChangeFn,
	type PaginationState,
	type RowData,
	type SortingState,
	type Updater,
	useTable,
} from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";

import {
	type DataTableColumnDef,
	type DataTableFeatures,
	type DataTableInstance,
	dataTableFeatures,
} from "~/lib/table-features";

export interface UseDataTableOptions<TData extends RowData> {
	data: TData[];
	columns: DataTableColumnDef<TData>[];
	/**
	 * Stable storage key for column-visibility persistence in `localStorage`.
	 * Convention: `"<app>.<surface>.columns"` (e.g. `"seller.products.columns"`).
	 * Omit to keep visibility session-only.
	 */
	storageKey?: string;
	/** Initial visibility state. Becomes the target of `Ripristina predefinite`. */
	initialColumnVisibility?: ColumnVisibilityState;
	/**
	 * Enable server-side pagination. When present, the table is in `manualPagination`
	 * mode and you own the page state via your route's search params.
	 */
	manualPagination?: {
		pageIndex: number;
		pageSize: number;
		pageCount: number;
		onPaginationChange: (state: PaginationState) => void;
	};
	/**
	 * Enable server-side sorting. When present, the table is in `manualSorting`
	 * mode: TanStack tracks the state and exposes `column.getToggleSortingHandler()`
	 * / `column.getIsSorted()` to your column headers, but does not sort client-side.
	 * The caller fetches sorted data from the API based on `sorting`.
	 */
	manualSorting?: {
		sorting: SortingState;
		onSortingChange: (state: SortingState) => void;
	};
	/** Stable row identity. Defaults to `index`; pass when rows have a real id. */
	getRowId?: (row: TData, index: number) => string;
}

/**
 * Project wrapper around TanStack's `useTable` that adds:
 *
 * - localStorage-backed column visibility persistence keyed by `storageKey`,
 *   SSR-safe via post-mount hydration to avoid React 19 mismatches.
 * - Server-side pagination glue: pass `manualPagination` and the table runs
 *   in `manualPagination: true` mode while you keep the source of truth in
 *   the route's search params.
 *
 * The feature registry lives in `~/lib/table-features` — v9 requires features
 * to be declared up front, and every bibs table shares the same set.
 *
 * All other table features (selection, sorting, filtering) are left to the
 * caller — opt-in via TanStack's standard APIs.
 */
export function useDataTable<TData extends RowData>({
	data,
	columns,
	storageKey,
	initialColumnVisibility,
	manualPagination,
	manualSorting,
	getRowId,
}: UseDataTableOptions<TData>): DataTableInstance<TData> {
	const defaults = useMemo<ColumnVisibilityState>(
		() => initialColumnVisibility ?? {},
		[initialColumnVisibility],
	);

	const [columnVisibility, setColumnVisibility] =
		useState<ColumnVisibilityState>(defaults);
	const [hydrated, setHydrated] = useState(false);

	// Hydrate stored visibility on mount.
	useEffect(() => {
		if (!storageKey) {
			setHydrated(true);
			return;
		}
		if (typeof window === "undefined") return;
		try {
			const raw = window.localStorage.getItem(storageKey);
			if (raw) {
				const parsed = JSON.parse(raw) as unknown;
				if (parsed && typeof parsed === "object") {
					setColumnVisibility((prev) => ({
						...prev,
						...(parsed as ColumnVisibilityState),
					}));
				}
			}
		} catch {
			// Storage disabled / quota / JSON parse: fall back to defaults.
		}
		setHydrated(true);
	}, [storageKey]);

	// Persist on change once hydrated.
	useEffect(() => {
		if (!hydrated || !storageKey) return;
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(storageKey, JSON.stringify(columnVisibility));
		} catch {
			// Ignore persistence failures.
		}
	}, [columnVisibility, hydrated, storageKey]);

	const onColumnVisibilityChange: OnChangeFn<ColumnVisibilityState> = (
		updater: Updater<ColumnVisibilityState>,
	) => {
		setColumnVisibility((prev) =>
			typeof updater === "function" ? updater(prev) : updater,
		);
	};

	const onPaginationChange: OnChangeFn<PaginationState> | undefined =
		manualPagination
			? (updater) => {
					const prev: PaginationState = {
						pageIndex: manualPagination.pageIndex,
						pageSize: manualPagination.pageSize,
					};
					const next = typeof updater === "function" ? updater(prev) : updater;
					manualPagination.onPaginationChange(next);
				}
			: undefined;

	const onSortingChange: OnChangeFn<SortingState> | undefined = manualSorting
		? (updater) => {
				const prev = manualSorting.sorting;
				const next = typeof updater === "function" ? updater(prev) : updater;
				manualSorting.onSortingChange(next);
			}
		: undefined;

	return useTable<DataTableFeatures, TData>({
		features: dataTableFeatures,
		data,
		columns,
		initialState: { columnVisibility: defaults },
		state: {
			columnVisibility,
			...(manualPagination
				? {
						pagination: {
							pageIndex: manualPagination.pageIndex,
							pageSize: manualPagination.pageSize,
						},
					}
				: {}),
			...(manualSorting ? { sorting: manualSorting.sorting } : {}),
		},
		onColumnVisibilityChange,
		onPaginationChange,
		onSortingChange,
		manualPagination: Boolean(manualPagination),
		pageCount: manualPagination?.pageCount,
		manualSorting: Boolean(manualSorting),
		getRowId,
	});
}
