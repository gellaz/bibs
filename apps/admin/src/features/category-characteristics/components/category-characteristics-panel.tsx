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
import { DataTable } from "@bibs/ui/components/data-table";
import { Input } from "@bibs/ui/components/input";
import { Switch } from "@bibs/ui/components/switch";
import { TabNav } from "@bibs/ui/components/tab-nav";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import {
	type CharacteristicDataType,
	DATA_TYPE_LABELS,
	productsPhrase,
} from "@/features/product-characteristics/data-type";
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
			header: "Caratteristica",
			meta: { cellClassName: "pl-4", headerClassName: "pl-4" },
			cell: ({ row }) => (
				<div className="flex flex-col">
					<span className="font-medium">{row.original.name}</span>
					<span className="text-muted-foreground text-xs">
						{DATA_TYPE_LABELS[row.original.dataType]}
						{row.original.unit ? ` · ${row.original.unit}` : ""}
						{row.original.valueCount > 0
							? ` · valori su ${productsPhrase(row.original.valueCount)}`
							: ""}
					</span>
				</div>
			),
		},
		{
			id: "included",
			header: "Inclusa",
			meta: { cellClassName: "w-24" },
			cell: ({ row }) => (
				<Switch
					checked={row.original.included}
					disabled={isMutating}
					onCheckedChange={(v) => toggleIncluded(row.original, v)}
					aria-label={`Includi ${row.original.name}`}
				/>
			),
		},
		{
			id: "required",
			header: "Obbligatoria",
			meta: { cellClassName: "w-28 pr-4", headerClassName: "pr-4" },
			cell: ({ row }) => (
				<Switch
					checked={row.original.required}
					disabled={!row.original.included || isMutating}
					onCheckedChange={(v) =>
						include.mutate({ characteristicId: row.original.id, required: v })
					}
					aria-label={`Rendi obbligatoria ${row.original.name}`}
				/>
			),
		},
	];

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			{error && (
				<p className="text-destructive text-sm">
					Errore nel caricamento: {error.message}
				</p>
			)}

			<TabNav
				tabs={[
					{ value: "all", label: "Tutte", count: rows.length },
					{ value: "included", label: "Incluse", count: includedCount },
				]}
				activeTab={tab}
				onTabChange={(v) => setTab(v as Tab)}
			/>

			<div className="relative">
				<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
				<Input
					placeholder="Cerca caratteristica..."
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
								? "Nessuna caratteristica inclusa in questa sotto-categoria."
								: "Nessuna caratteristica corrisponde alla ricerca."}
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
							Rimuovere "{pendingRemoval?.name}"?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Questa caratteristica ha valori su{" "}
							{productsPhrase(pendingRemoval?.valueCount ?? 0)} di questa
							sotto-categoria: verranno eliminati definitivamente.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setPendingRemoval(null)}>
							Annulla
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
							Rimuovi ed elimina i valori
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
