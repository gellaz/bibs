"use client";

import type { RowData } from "@tanstack/react-table";
import { Columns3Icon, LockIcon } from "lucide-react";

import { Button } from "~/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/dropdown-menu";
import type {
	DataTableColumn,
	DataTableCoreInstance,
} from "~/lib/table-features";

interface TableColumnsToggleProps<TData extends RowData> {
	table: DataTableCoreInstance<TData>;
	/** Side to align the menu against the trigger. Default `"end"`. */
	align?: "start" | "center" | "end";
	/** Italian by default; override for English contexts. */
	labels?: {
		trigger?: string;
		menuTitle?: string;
		reset?: string;
		locked?: string;
	};
	className?: string;
}

const DEFAULT_LABELS = {
	trigger: "Colonne visibili",
	menuTitle: "Colonne",
	reset: "Ripristina predefinite",
	locked: "Sempre visibile",
} as const;

function getMenuLabel<TData extends RowData>(
	col: DataTableColumn<TData>,
): string | null {
	const meta = col.columnDef.meta;
	if (meta?.menuLabel) return meta.menuLabel;
	const header = col.columnDef.header;
	if (typeof header === "string" && header.length > 0) return header;
	return null;
}

/**
 * Trigger + dropdown that exposes per-column visibility for a TanStack table.
 *
 * Designed to live inside the last `<th>` of the header row, so the affordance
 * travels with the table and stays anchored right. Columns without a string
 * header and without `meta.menuLabel` are skipped — they're chrome (checkbox,
 * actions) and not real data columns.
 */
export function TableColumnsToggle<TData extends RowData>({
	table,
	align = "end",
	labels: labelOverrides,
	className,
}: TableColumnsToggleProps<TData>) {
	"use no memo";

	const labels = { ...DEFAULT_LABELS, ...labelOverrides };

	const menuColumns = table
		.getAllLeafColumns()
		.filter((col) => getMenuLabel(col) !== null);

	const initial = table.initialState.columnVisibility ?? {};
	// Core tables (what a header renderer hands us) expose state through
	// the store; the enclosing DataTable re-renders on visibility changes, so
	// this snapshot is always read fresh.
	const current = table.store.state.columnVisibility;
	const isAtDefault = menuColumns.every((col) => {
		const def = initial[col.id] ?? true;
		const cur = current[col.id] ?? true;
		return def === cur;
	});

	const visible = menuColumns.filter((c) => c.getIsVisible()).length;
	const total = menuColumns.length;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={labels.trigger}
					title={labels.trigger}
					className={className}
				>
					<Columns3Icon />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent align={align} className="min-w-56">
				<div className="flex items-center justify-between gap-2 px-1.5 py-1">
					<DropdownMenuLabel className="text-foreground px-0 py-0 text-sm font-semibold tracking-normal normal-case">
						{labels.menuTitle}
					</DropdownMenuLabel>
					<span
						aria-hidden="true"
						className="text-muted-foreground text-xs tabular-nums"
					>
						{visible}/{total}
					</span>
				</div>
				<DropdownMenuSeparator />

				{menuColumns.map((col) => {
					const label = getMenuLabel(col) ?? col.id;
					const canHide = col.getCanHide();
					return (
						<DropdownMenuCheckboxItem
							key={col.id}
							checked={col.getIsVisible()}
							disabled={!canHide}
							onSelect={(event) => event.preventDefault()}
							onCheckedChange={(value) => col.toggleVisibility(Boolean(value))}
						>
							<span className="flex-1 truncate">{label}</span>
							{!canHide ? (
								<LockIcon
									aria-label={labels.locked}
									className="text-muted-foreground/70 mr-5"
								/>
							) : null}
						</DropdownMenuCheckboxItem>
					);
				})}

				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={(event) => {
						event.preventDefault();
						table.resetColumnVisibility();
					}}
					disabled={isAtDefault}
				>
					{labels.reset}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
