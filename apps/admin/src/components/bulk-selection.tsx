import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import type { UseRowSelectionResult } from "@bibs/ui/hooks/use-row-selection";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { MoreHorizontalIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { m } from "@/paraglide/messages";

// Stesse misure della lista prodotti del seller: w-12 per le due colonne
// fissate ai bordi, così select e azioni restano simmetriche.
// La selezione si legge a ogni render da `getSelection`: se la colonna
// cambiasse a ogni selezione, TanStack rimonterebbe le celle e la casella
// appena spuntata da tastiera perderebbe il focus.
export function selectColumn<T extends { id: string; name: string }>(
	getSelection: () => UseRowSelectionResult,
): DataTableColumnDef<T> {
	return {
		id: "select",
		enableHiding: false,
		meta: {
			// `[&:has([role=checkbox])]:pr-0` di TableCell porterebbe la casella
			// addosso al separatore: si rimette il pr-4.
			headerClassName: "w-12 px-4 [&:has([role=checkbox])]:pr-4",
			cellClassName: "w-12 px-4 [&:has([role=checkbox])]:pr-4",
			sticky: "left",
		},
		header: () => {
			const selection = getSelection();
			return (
				<div className="flex justify-center">
					<Checkbox
						checked={selection.headerCheckboxState === "checked"}
						indeterminate={selection.headerCheckboxState === "indeterminate"}
						onCheckedChange={() => selection.toggleAllOnPage()}
						aria-label={m.common_select_all()}
					/>
				</div>
			);
		},
		cell: ({ row }) => {
			const selection = getSelection();
			return (
				<div className="flex justify-center">
					<Checkbox
						checked={selection.isSelected(row.original.id)}
						onCheckedChange={() => selection.toggleOne(row.original.id)}
						aria-label={m.common_select_row({ name: row.original.name })}
					/>
				</div>
			);
		},
	};
}

export function RowActionsMenu({
	name,
	children,
}: {
	name: string;
	children: ReactNode;
}) {
	return (
		<div className="flex justify-center">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							aria-label={m.common_row_actions({ name })}
						/>
					}
				>
					<MoreHorizontalIcon className="size-4" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-auto">
					{children}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

export function BulkToolbar({
	count,
	onClear,
	children,
}: {
	count: number;
	onClear: () => void;
	children: ReactNode;
}) {
	if (count === 0) return null;
	return (
		<div className="bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-2.5 shadow-sm">
			<span aria-hidden className="bg-primary size-1.5 shrink-0 rounded-full" />
			<span className="text-sm font-medium">
				{count === 1
					? m.common_bulk_selected_one({ count })
					: m.common_bulk_selected({ count })}
			</span>
			<Button
				variant="ghost"
				size="sm"
				onClick={onClear}
				className="text-muted-foreground hover:text-foreground -ml-1 h-7 px-2"
			>
				<XIcon className="size-3.5" />
				{m.common_bulk_clear()}
			</Button>
			<div className="ml-auto flex flex-wrap gap-2">{children}</div>
		</div>
	);
}
