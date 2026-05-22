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
import type { ReactNode } from "react";

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
function stickyHeaderClass(sticky: "left" | "right" | undefined) {
	if (sticky === "left") return "sticky left-0 z-20 bg-card border-r";
	if (sticky === "right") return "sticky right-0 z-20 bg-card border-l";
	return undefined;
}

function stickyCellClass(sticky: "left" | "right" | undefined) {
	const stateBg =
		"bg-card group-hover:bg-muted/50 group-data-[state=selected]:bg-muted";
	if (sticky === "left") return cn("sticky left-0 z-10 border-r", stateBg);
	if (sticky === "right") return cn("sticky right-0 z-10 border-l", stateBg);
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

	return (
		<div
			className={cn(
				// `isolate` crea uno stacking context locale cosi' le sticky cells
				// (z-10/z-20) restano confinate alla tabella e non possono salire
				// sopra elementi page-level come la breadcrumb sticky.
				"bg-card isolate overflow-hidden rounded-lg border shadow-sm",
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
