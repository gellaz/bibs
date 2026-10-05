import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { Input } from "@bibs/ui/components/input";
import { Switch } from "@bibs/ui/components/switch";
import { DataTable } from "@bibs/ui/custom/data-table";
import { TabNav } from "@bibs/ui/custom/tab-nav";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import {
	type CharacteristicDataType,
	dataTypeLabel,
} from "@/features/product-characteristics/data-type";
import { m } from "@/paraglide/messages";
import { useCategoryCharacteristics } from "../hooks/use-category-characteristics";

interface Row {
	id: string;
	name: string;
	dataType: CharacteristicDataType;
	unit: string | null;
	included: boolean;
	required: boolean;
	valueCount: number;
}

type Tab = "all" | "included";

/** «valori su N prodotti» nella riga di una caratteristica. */
export function valuesOn(count: number) {
	return count === 1
		? m.characteristics_values_on_one({ count })
		: m.characteristics_values_on({ count });
}

/** Il testo della conferma di rimozione di una caratteristica con valori. */
export function removeDescription(count: number) {
	return count === 1
		? m.characteristics_remove_description_one({ count })
		: m.characteristics_remove_description({ count });
}

export function CategoryCharacteristicsPanel({
	categoryId,
}: {
	categoryId: string;
}) {
	"use no memo";

	const { rows, isLoading, error, include, remove, isMutating } =
		useCategoryCharacteristics(categoryId);
	const [tab, setTab] = useState<Tab>("all");
	const [search, setSearch] = useState("");
	const [pendingRemoval, setPendingRemoval] = useState<Row | null>(null);

	const needle = search.trim().toLowerCase();
	const visible = rows.filter(
		(r) =>
			(tab === "all" || r.included) && r.name.toLowerCase().includes(needle),
	);
	const includedCount = rows.filter((r) => r.included).length;

	const toggleIncluded = (row: Row, next: boolean) => {
		if (next) {
			include.mutate({ characteristicId: row.id, required: false });
		} else if (row.valueCount > 0) {
			setPendingRemoval(row);
		} else {
			remove.mutate({ characteristicId: row.id, confirmAffected: 0 });
		}
	};

	const columns: DataTableColumnDef<Row>[] = [
		{
			id: "name",
			header: m.characteristics_column_name(),
			meta: { cellClassName: "pl-4", headerClassName: "pl-4" },
			cell: ({ row }) => (
				<div className="flex flex-col">
					<span className="font-medium">{row.original.name}</span>
					<span className="text-muted-foreground text-xs">
						{dataTypeLabel(row.original.dataType)}
						{row.original.unit ? ` · ${row.original.unit}` : ""}
						{row.original.valueCount > 0
							? ` · ${valuesOn(row.original.valueCount)}`
							: ""}
					</span>
				</div>
			),
		},
		{
			id: "included",
			header: m.characteristics_column_included(),
			meta: { cellClassName: "w-24" },
			cell: ({ row }) => (
				<Switch
					checked={row.original.included}
					disabled={isMutating}
					onCheckedChange={(v) => toggleIncluded(row.original, v)}
					aria-label={m.characteristics_include_aria({
						name: row.original.name,
					})}
				/>
			),
		},
		{
			id: "required",
			header: m.characteristics_column_required(),
			meta: { cellClassName: "w-28 pr-4", headerClassName: "pr-4" },
			cell: ({ row }) => (
				<Switch
					checked={row.original.required}
					disabled={!row.original.included || isMutating}
					onCheckedChange={(v) =>
						include.mutate({ characteristicId: row.original.id, required: v })
					}
					aria-label={m.characteristics_require_aria({
						name: row.original.name,
					})}
				/>
			),
		},
	];

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			{error && (
				<p className="text-destructive text-sm">
					{m.common_load_error_with_message({ message: error.message })}
				</p>
			)}

			<TabNav
				tabs={[
					{
						value: "all",
						label: m.characteristics_tab_all(),
						count: rows.length,
					},
					{
						value: "included",
						label: m.characteristics_tab_included(),
						count: includedCount,
					},
				]}
				activeTab={tab}
				onTabChange={(v) => setTab(v as Tab)}
				label={m.characteristics_tabs_label()}
			/>

			<div className="relative">
				<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
				<Input
					placeholder={m.characteristics_search()}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="pl-9"
				/>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<DataTable
					data={visible}
					columns={columns}
					getRowId={(r) => r.id}
					isLoading={isLoading}
					isRowSelected={(r) => r.original.included}
					emptyState={
						<p className="text-muted-foreground text-sm">
							{tab === "included"
								? m.characteristics_matrix_empty_included()
								: m.characteristics_matrix_empty_search()}
						</p>
					}
				/>
			</div>

			<AlertDialog
				open={!!pendingRemoval}
				onOpenChange={(open) => !open && setPendingRemoval(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{m.characteristics_remove_title({
								name: pendingRemoval?.name ?? "",
							})}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{removeDescription(pendingRemoval?.valueCount ?? 0)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setPendingRemoval(null)}>
							{m.common_cancel()}
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								if (!pendingRemoval) return;
								remove.mutate({
									characteristicId: pendingRemoval.id,
									confirmAffected: pendingRemoval.valueCount,
								});
								setPendingRemoval(null);
							}}
						>
							{m.characteristics_remove_action()}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
