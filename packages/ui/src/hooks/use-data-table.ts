"use client";

import {
	type ColumnDef,
	getCoreRowModel,
	type OnChangeFn,
	type PaginationState,
	type RowData,
	type Table,
	type Updater,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";

// Project-wide augmentation: add bibs-specific meta keys to TanStack's
// ColumnMeta so they're typed on every ColumnDef.
declare module "@tanstack/react-table" {
	// biome-ignore lint/correctness/noUnusedVariables: required for module augmentation
	interface ColumnMeta<TData extends RowData, TValue> {
		/**
		 * Italian label shown in the column-visibility menu. Falls back to a
		 * string `header` when omitted; required for columns whose header is a
		 * function (e.g. a checkbox or a toggle).
		 */
		menuLabel?: string;
		/** Optional class applied to the `<th>` for this column. */
		headerClassName?: string;
		/** Optional class applied to every `<td>` for this column. */
		cellClassName?: string;
	}
}

export interface UseDataTableOptions<TData> {
	data: TData[];
	columns: ColumnDef<TData, unknown>[];
	/**
	 * Stable storage key for column-visibility persistence in `localStorage`.
	 * Convention: `"<app>.<surface>.columns"` (e.g. `"seller.products.columns"`).
	 * Omit to keep visibility session-only.
	 */
	storageKey?: string;
	/** Initial visibility state. Becomes the target of `Ripristina predefinite`. */
	initialColumnVisibility?: VisibilityState;
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
	/** Stable row identity. Defaults to `index`; pass when rows have a real id. */
	getRowId?: (row: TData, index: number) => string;
}

/**
 * Project wrapper around `useReactTable` that adds:
 *
 * - localStorage-backed column visibility persistence keyed by `storageKey`,
 *   SSR-safe via post-mount hydration to avoid React 19 mismatches.
 * - Server-side pagination glue: pass `manualPagination` and the table runs
 *   in `manualPagination: true` mode while you keep the source of truth in
 *   the route's search params.
 *
 * All other table features (selection, sorting, filtering) are left to the
 * caller — opt-in via TanStack's standard APIs.
 */
export function useDataTable<TData>({
	data,
	columns,
	storageKey,
	initialColumnVisibility,
	manualPagination,
	getRowId,
}: UseDataTableOptions<TData>): Table<TData> {
	const defaults = useMemo<VisibilityState>(
		() => initialColumnVisibility ?? {},
		[initialColumnVisibility],
	);

	const [columnVisibility, setColumnVisibility] =
		useState<VisibilityState>(defaults);
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
						...(parsed as VisibilityState),
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

	const onColumnVisibilityChange: OnChangeFn<VisibilityState> = (
		updater: Updater<VisibilityState>,
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

	return useReactTable<TData>({
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
		},
		onColumnVisibilityChange,
		onPaginationChange,
		manualPagination: Boolean(manualPagination),
		pageCount: manualPagination?.pageCount,
		getCoreRowModel: getCoreRowModel(),
		getRowId,
	});
}
