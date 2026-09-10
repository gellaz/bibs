import {
	type CellData,
	columnSizingFeature,
	columnVisibilityFeature,
	metaHelper,
	type ReactTable,
	type RowData,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	type Column as TanStackColumn,
	type ColumnDef as TanStackColumnDef,
	type Row as TanStackRow,
	type Table as TanStackTable,
	tableFeatures,
} from "@tanstack/react-table";

/**
 * bibs-specific keys on every column's `meta`.
 *
 * Registered as a per-table `columnMeta` slot below rather than by augmenting
 * TanStack's global `ColumnMeta` interface: the slot is scoped to tables built
 * from {@link dataTableFeatures} (which is all of ours) and avoids a
 * `declare module` whose type-parameter list has to be kept byte-identical to
 * upstream's, variance annotations included.
 */
export interface DataTableColumnMeta {
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
	/**
	 * Freeze this column to the left or right edge of the horizontal scroll
	 * container. Requires the DataTable to live inside a scroll container
	 * (its default `overflow-auto` is enough). Both header and body cells
	 * are made `position: sticky` with a `bg-card` base + neutral border
	 * separator. Row-state styling (hover/selected) is mirrored from
	 * `<TableRow>` so sticky cells track the rest of the row.
	 */
	sticky?: "left" | "right";
}

/**
 * The one feature registry every bibs table is built from.
 *
 * TanStack Table v9 no longer bundles features: each one must be registered
 * explicitly so unused code tree-shakes away. This list mirrors what the
 * DataTable actually calls, nothing more:
 *
 * - `columnSizingFeature` — `header.getSize()` for explicit column widths
 * - `columnVisibilityFeature` — the `TableColumnsToggle` menu and its
 *   localStorage persistence
 * - `rowPaginationFeature` — server-side pagination (`manualPagination`)
 * - `rowSelectionFeature` — `row.getIsSelected()` fallback for surfaces that
 *   do not own selection themselves via the DataTable's `isRowSelected`
 * - `rowSortingFeature` — server-side sorting (`manualSorting`)
 *
 * No row-model slots are registered: sorting, filtering and pagination all
 * happen API-side, so the automatic core row model is all we need. Adding a
 * client-side feature means registering both its `*Feature` and its matching
 * `create*RowModel()` slot here, feature first.
 */
export const dataTableFeatures = tableFeatures({
	columnSizingFeature,
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof dataTableFeatures;

/**
 * `ColumnDef` already bound to {@link dataTableFeatures}.
 *
 * v9 threads the feature registry through every core type, so v8's bare
 * `ColumnDef<TData>` is now `ColumnDef<TFeatures, TData, TValue>`. Call sites
 * use these aliases instead of spelling the registry out each time.
 */
export type DataTableColumnDef<
	TData extends RowData,
	TValue extends CellData = CellData,
> = TanStackColumnDef<DataTableFeatures, TData, TValue>;

/** `Column` bound to {@link dataTableFeatures}. */
export type DataTableColumn<
	TData extends RowData,
	TValue extends CellData = CellData,
> = TanStackColumn<DataTableFeatures, TData, TValue>;

/** `Row` bound to {@link dataTableFeatures}. */
export type DataTableRow<TData extends RowData> = TanStackRow<
	DataTableFeatures,
	TData
>;

/**
 * The table instance `useDataTable` returns, bound to
 * {@link dataTableFeatures}.
 *
 * This is the React adapter's `ReactTable`, not table-core's `Table`: the
 * adapter is what adds `state`, `Subscribe` and `FlexRender` on top of the
 * core instance. `TSelected` is left at its default, so `table.state` holds
 * the full registered state (v8-style — any state change re-renders).
 */
export type DataTableInstance<TData extends RowData> = ReactTable<
	DataTableFeatures,
	TData
>;

/**
 * The *core* table instance, bound to {@link dataTableFeatures}.
 *
 * This is what a column's `header` / `cell` renderer receives in its context —
 * table-core's `Table`, without the React adapter's `state` / `Subscribe` /
 * `FlexRender`. Components meant to be dropped inside a column renderer (e.g.
 * `TableColumnsToggle`) should take this, not {@link DataTableInstance}: a
 * `DataTableInstance` is structurally assignable to it, so typing the prop
 * this way accepts both. Read state off it via `table.store.state`.
 */
export type DataTableCoreInstance<TData extends RowData> = TanStackTable<
	DataTableFeatures,
	TData
>;
