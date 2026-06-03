"use client";

import {
	type Column,
	type ColumnDef,
	flexRender,
	type Row,
	type SortingState,
	type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { Spinner } from "~/components/spinner";
import {
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	Table as TablePrimitive,
	TableRow,
} from "~/components/table";
import { useDataTable } from "~/hooks/use-data-table";
import { cn } from "~/lib/utils";

// Classi per colonne `meta.sticky`. Header e cell hanno bg / z-index distinti:
// l'header sta sopra ai body sticky cells in caso di overlap; le body cells
// rispecchiano hover/selected del <tr> per mantenere coerenza con la riga.
//
// Il separator usa INSET box-shadow (non border, non outset). Border-collapse:
//   collapse fonde i border delle celle adiacenti: il border-r della sticky
//   cell verrebbe "trascinato via" insieme alla cella vicina quando l'utente
//   scrolla. Outset box-shadow viene dipinto correttamente ma "out-painted"
//   dalla cella adiacente in `<table>` border-collapse (anche con z-index 10
//   sulla sticky, il painting model di table-cells in collapse mode lascia
//   passare la cella vicina sopra lo shadow esterno). Inset paint dentro la
//   cella sticky stessa: niente puo' coprirlo, e resta ancorato al suo edge
//   in ogni scroll position.
//
// 2px solid in colori con ~0.4 di delta sul bg-card: ben visibile sempre,
// anche senza contenuto in scroll sotto. Trade-off: si perde il soft-fade
// di scroll-affordance che dava lo shadow outset (per averlo servirebbe un
// pseudo-elemento ::after absolutely positioned; non vale lo zucchero
// extra per il caso di scroll, gia' segnalato dal contenuto che sparisce
// sotto la sticky bg-card opaca).
// SHADOW_RIGHT su LEFT-sticky cells: linea inset 1px (sempre) + soft fade
// outset via ::after visibile solo quando il wrapper ha data-scrolled-left.
// ::after eredita lo stacking context della cella sticky (z-10) e quindi
// non viene coperto dalla cella adiacente, a differenza dell'outset
// box-shadow nel painting model di <table> border-collapse.
const SHADOW_RIGHT =
	"shadow-[inset_-1px_0_0_0_var(--color-border)] " +
	"after:pointer-events-none after:absolute after:inset-y-0 after:left-full " +
	"after:w-2 after:bg-gradient-to-r after:from-black/10 after:to-transparent " +
	"after:opacity-0 after:transition-opacity after:duration-150 after:content-[''] " +
	"dark:after:from-black/35 " +
	"group-data-[scrolled-left=true]/scroll:after:opacity-100";
const SHADOW_LEFT =
	"shadow-[inset_1px_0_0_0_var(--color-border)] " +
	"before:pointer-events-none before:absolute before:inset-y-0 before:right-full " +
	"before:w-2 before:bg-gradient-to-l before:from-black/10 before:to-transparent " +
	"before:opacity-0 before:transition-opacity before:duration-150 before:content-[''] " +
	"dark:before:from-black/35 " +
	"group-data-[scrolled-right=true]/scroll:before:opacity-100";

function stickyHeaderClass(sticky: "left" | "right" | undefined) {
	if (sticky === "left") return cn("sticky left-0 z-20 bg-card", SHADOW_RIGHT);
	if (sticky === "right") return cn("sticky right-0 z-20 bg-card", SHADOW_LEFT);
	return undefined;
}

function stickyCellClass(sticky: "left" | "right" | undefined) {
	// Bg SOLIDI (no /50 alpha) cosi' il contenuto in scroll non traspare
	// mai sotto le sticky cells. Su hover sono leggermente piu' sature
	// di muted/50 (default del TR primitive sulle altre celle), trade-off
	// accettato in cambio della no-transparency garantita.
	const stateBg =
		"bg-card group-hover:bg-muted group-data-[state=selected]:bg-muted";
	if (sticky === "left") return cn("sticky left-0 z-10", SHADOW_RIGHT, stateBg);
	if (sticky === "right")
		return cn("sticky right-0 z-10", SHADOW_LEFT, stateBg);
	return undefined;
}

interface DataTableProps<TData> {
	data: TData[];
	columns: ColumnDef<TData, unknown>[];
	/**
	 * Stable storage key for column-visibility persistence in `localStorage`.
	 * Convention: `"<app>.<surface>.columns"`.
	 */
	storageKey?: string;
	/** Initial visibility (defaults to all visible). Target of "Ripristina". */
	initialColumnVisibility?: VisibilityState;
	/** Stable row identity; recommended when rows have a real id. */
	getRowId?: (row: TData, index: number) => string;
	/** Show a centered spinner instead of the table while data loads. */
	isLoading?: boolean;
	/**
	 * Rendered inside a full-width `<td>` when the table has zero rows.
	 * Caller controls icon and copy; the cell handles `colSpan` and centering.
	 */
	emptyState?: ReactNode;
	/**
	 * When the table has zero rows, render `emptyState` in place of the whole
	 * table (header included). Use for first-run emptiness — no search/filter
	 * active — where a header has nothing to sort or select. Keep it `false`
	 * for filter-produced emptiness so the table structure stays put while
	 * the user adjusts the query.
	 */
	hideHeaderWhenEmpty?: boolean;
	/** Extra class for each row. Function form receives the TanStack row. */
	rowClassName?: string | ((row: Row<TData>) => string);
	/** Class on the rounded card wrapper around the table. */
	containerClassName?: string;
	/**
	 * Enable server-side sorting. The caller owns `sorting` (typically as URL
	 * search params) and refetches on change. Pass `sorting` and the setter;
	 * mark sortable columns with `enableSorting: true` and use `SortableHeader`
	 * in their `header` renderer.
	 */
	manualSorting?: {
		sorting: SortingState;
		onSortingChange: (state: SortingState) => void;
	};
}

/**
 * Render a TanStack-powered data table using the project's `<Table>` primitives.
 *
 * The table instance is created internally — this matters because React
 * Compiler memoizes by prop reference, and TanStack returns a stable table
 * across renders. Keeping the instance inside the component preserves
 * re-renders when `data` or column visibility change.
 *
 * For column-toggle in the header, reference the `table` arg in a column's
 * `header` renderer:
 *
 * ```tsx
 * { id: "actions", header: ({ table }) => <TableColumnsToggle table={table} /> }
 * ```
 */
export function DataTable<TData>({
	data,
	columns,
	storageKey,
	initialColumnVisibility,
	getRowId,
	isLoading,
	emptyState,
	hideHeaderWhenEmpty,
	rowClassName,
	containerClassName,
	manualSorting,
}: DataTableProps<TData>) {
	"use no memo";

	const table = useDataTable({
		data,
		columns,
		storageKey,
		initialColumnVisibility,
		getRowId,
		manualSorting,
	});

	// Wrapper ref per pilotare data-scrolled-left/right via JS. Tailwind
	// non puo' osservare scrollLeft (non e' una proprieta' CSS); il pattern
	// piu' pulito e' settare data-attrs sull'antenato e leggerli dalle
	// sticky cells via `group-data-[…]/scroll:` (vedi SHADOW_RIGHT/LEFT).
	const wrapperRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (isLoading) return;
		const wrapper = wrapperRef.current;
		if (!wrapper) return;
		const scroller = wrapper.querySelector(
			'[data-slot="table-container"]',
		) as HTMLElement | null;
		if (!scroller) return;

		const update = () => {
			const sl = scroller.scrollLeft;
			const max = scroller.scrollWidth - scroller.clientWidth;
			wrapper.dataset.scrolledLeft = sl > 0 ? "true" : "false";
			// `max - 1` per tollerare arrotondamenti subpixel quando si è in fondo.
			wrapper.dataset.scrolledRight = sl < max - 1 ? "true" : "false";
		};

		update();
		scroller.addEventListener("scroll", update, { passive: true });
		// ResizeObserver sul <table> intercetta cambi di colonne visibili o
		// di dati che alterano scrollWidth pur lasciando lo scroller stesso
		// invariato.
		const ro = new ResizeObserver(update);
		ro.observe(scroller);
		const tableEl = scroller.querySelector("table");
		if (tableEl) ro.observe(tableEl);

		return () => {
			scroller.removeEventListener("scroll", update);
			ro.disconnect();
		};
	}, [isLoading]);

	if (isLoading) {
		return (
			<div
				className={cn(
					"bg-card flex h-64 items-center justify-center rounded-lg border",
					containerClassName,
				)}
			>
				<Spinner className="size-8" />
			</div>
		);
	}

	const rows = table.getRowModel().rows;
	const visibleColumnCount = table.getVisibleLeafColumns().length;

	if (rows.length === 0 && hideHeaderWhenEmpty) {
		return (
			<div
				className={cn(
					"bg-card flex items-center justify-center rounded-lg border shadow-sm",
					containerClassName,
				)}
			>
				{emptyState}
			</div>
		);
	}

	return (
		<div
			ref={wrapperRef}
			data-scrolled-left="false"
			data-scrolled-right="false"
			className={cn(
				// `isolate` crea uno stacking context locale cosi' le sticky cells
				// (z-10/z-20) restano confinate alla tabella e non possono salire
				// sopra elementi page-level come la breadcrumb sticky.
				// `group/scroll` permette alle sticky cells di reagire ai
				// data-scrolled-* settati dallo scroll listener via varianti
				// `group-data-[…]/scroll:`.
				"group/scroll bg-card isolate overflow-hidden rounded-lg border shadow-sm",
				containerClassName,
			)}
		>
			<TablePrimitive>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow
							key={headerGroup.id}
							className="bg-transparent hover:bg-transparent"
						>
							{headerGroup.headers.map((header) => {
								const meta = header.column.columnDef.meta;
								const explicitSize =
									header.getSize() !== 150 ? header.getSize() : undefined;
								return (
									<TableHead
										key={header.id}
										className={cn(
											stickyHeaderClass(meta?.sticky),
											meta?.headerClassName,
										)}
										style={
											explicitSize !== undefined
												? { width: explicitSize }
												: undefined
										}
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
									</TableHead>
								);
							})}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{rows.length > 0 ? (
						rows.map((row) => {
							const extraClass =
								typeof rowClassName === "function"
									? rowClassName(row)
									: rowClassName;
							return (
								<TableRow
									key={row.id}
									data-state={row.getIsSelected() ? "selected" : undefined}
									className={cn("group", extraClass)}
								>
									{row.getVisibleCells().map((cell) => {
										const meta = cell.column.columnDef.meta;
										return (
											<TableCell
												key={cell.id}
												className={cn(
													stickyCellClass(meta?.sticky),
													meta?.cellClassName,
												)}
											>
												{flexRender(
													cell.column.columnDef.cell,
													cell.getContext(),
												)}
											</TableCell>
										);
									})}
								</TableRow>
							);
						})
					) : (
						<TableRow className="hover:bg-transparent">
							<TableCell
								colSpan={visibleColumnCount}
								className="h-32 text-center"
							>
								{emptyState}
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</TablePrimitive>
		</div>
	);
}

/**
 * Header cell with sort affordance. Use inside a column `header` renderer
 * when the column has `enableSorting: true` and the DataTable receives
 * `manualSorting`. Cycles asc → desc → none on click.
 */
export function SortableHeader<TData, TValue>({
	column,
	children,
	className,
}: {
	column: Column<TData, TValue>;
	children: ReactNode;
	className?: string;
}) {
	const sorted = column.getIsSorted();
	const Icon =
		sorted === "asc"
			? ArrowUpIcon
			: sorted === "desc"
				? ArrowDownIcon
				: ChevronsUpDownIcon;
	return (
		<button
			type="button"
			onClick={column.getToggleSortingHandler()}
			className={cn(
				"focus-visible:ring-ring/40 -mx-1 inline-flex h-full w-fit items-center gap-1 rounded px-1 text-[0.72rem] font-medium tracking-[0.08em] uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none",
				sorted
					? "text-foreground"
					: "text-muted-foreground hover:text-foreground",
				className,
			)}
		>
			{children}
			<Icon
				className={cn(
					"size-3 shrink-0 transition-opacity",
					sorted ? "opacity-100" : "opacity-50",
				)}
				aria-hidden
			/>
		</button>
	);
}
