"use client";

import {
	type ColumnDef,
	flexRender,
	type Row,
	type VisibilityState,
} from "@tanstack/react-table";
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
}: DataTableProps<TData>) {
	"use no memo";

	const table = useDataTable({
		data,
		columns,
		storageKey,
		initialColumnVisibility,
		getRowId,
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
				"bg-card overflow-hidden rounded-lg border shadow-sm",
				containerClassName,
			)}
		>
			<TablePrimitive>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow
							key={headerGroup.id}
							className="bg-muted/50 hover:bg-muted/50"
						>
							{headerGroup.headers.map((header) => {
								const meta = header.column.columnDef.meta;
								const explicitSize =
									header.getSize() !== 150 ? header.getSize() : undefined;
								return (
									<TableHead
										key={header.id}
										className={meta?.headerClassName}
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
									{row.getVisibleCells().map((cell) => (
										<TableCell
											key={cell.id}
											className={cell.column.columnDef.meta?.cellClassName}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
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
