import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { ListChecksIcon } from "lucide-react";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
import type { CsvImportResult } from "@/features/csv-import/components/csv-import-dialog";
import { api } from "@/lib/api";
import { ProductCharacteristicForm } from "./components/product-characteristic-form";
import {
	CHARACTERISTIC_DATA_TYPES,
	type CharacteristicDataType,
	DATA_TYPE_LABELS,
	productsPhrase,
} from "./data-type";
import type { ProductCharacteristicSubmit } from "./schemas/product-characteristic";

interface ProductCharacteristic {
	id: string;
	name: string;
	dataType: CharacteristicDataType;
	unit: string | null;
	valueCount: number;
	options: {
		id: string;
		value: string;
		sortOrder: number;
		valueCount: number;
	}[];
	createdAt: Date | string;
}

const PREVIEW_OPTIONS = 3;

function toBody({ form }: ProductCharacteristicSubmit) {
	return {
		name: form.name,
		dataType: form.dataType,
		unit: form.dataType === "number" && form.unit ? form.unit : null,
		options:
			form.dataType === "enum"
				? form.options
						.filter((o) => o.value)
						.map((o) => ({
							...(o.optionId ? { id: o.optionId } : {}),
							value: o.value,
						}))
				: [],
	};
}

const extraColumns: DataTableColumnDef<ProductCharacteristic>[] = [
	{
		id: "dataType",
		header: "Tipo",
		meta: { cellClassName: "text-muted-foreground" },
		cell: ({ row }) => DATA_TYPE_LABELS[row.original.dataType],
	},
	{
		id: "unit",
		header: "Unità",
		meta: { cellClassName: "text-muted-foreground" },
		cell: ({ row }) => row.original.unit ?? "—",
	},
	{
		id: "options",
		header: "Valori ammessi",
		meta: { cellClassName: "text-muted-foreground max-w-80 truncate" },
		cell: ({ row }) => {
			const { options } = row.original;
			if (options.length === 0) return "—";
			const shown = options
				.slice(0, PREVIEW_OPTIONS)
				.map((o) => o.value)
				.join(", ");
			const rest = options.length - PREVIEW_OPTIONS;
			return rest > 0 ? `${shown} +${rest}` : shown;
		},
	},
];

function DataTypeFilter({
	values,
	set,
}: {
	values: Record<string, string>;
	set: (key: string, value: string) => void;
}) {
	return (
		<NativeSelect
			className="w-48"
			value={values.dataType ?? ""}
			onChange={(e) => set("dataType", e.target.value)}
			aria-label="Filtra per tipo"
		>
			<NativeSelectOption value="">Tutti i tipi</NativeSelectOption>
			{CHARACTERISTIC_DATA_TYPES.map((d) => (
				<NativeSelectOption key={d} value={d}>
					{DATA_TYPE_LABELS[d]}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}

export const productCharacteristicsConfig: CategoryCrudConfig<
	ProductCharacteristic,
	ProductCharacteristicSubmit
> = {
	queryKeyBase: "product-characteristics",
	storageKey: "admin.product-characteristics.columns",
	// La pastiglia delle sotto-categorie conta le voci della matrice, che una
	// cancellazione dal dizionario porta via in cascata.
	extraInvalidate: [["admin-configurations-counts"], ["product-categories"]],

	list: (q) =>
		api().admin["product-characteristics"].get({
			query: {
				page: q.page,
				limit: q.limit,
				...(q.search ? { search: q.search } : {}),
				...(q.dataType
					? { dataType: q.dataType as CharacteristicDataType }
					: {}),
				sortBy: q.sortBy,
				sortOrder: q.sortOrder,
			},
		}),
	create: (submit) =>
		api().admin["product-characteristics"].post(toBody(submit)),
	update: (id, submit) =>
		api()
			.admin["product-characteristics"]({ characteristicId: id })
			.patch({ ...toBody(submit), confirmAffected: submit.confirmAffected }),
	remove: (id, entity) =>
		api()
			.admin["product-characteristics"]({ characteristicId: id })
			.delete({ confirmAffected: entity.valueCount }),

	extraColumns,
	emptyIcon: <ListChecksIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <ProductCharacteristicForm {...p} />,
	editDefaults: (e) => ({
		form: {
			name: e.name,
			dataType: e.dataType,
			unit: e.unit ?? "",
			options: e.options.map((o) => ({ optionId: o.id, value: o.value })),
		},
		baseline: {
			dataType: e.dataType,
			valueCount: e.valueCount,
			options: e.options.map((o) => ({ id: o.id, valueCount: o.valueCount })),
		},
		confirmAffected: 0,
	}),

	toolbarFilter: (ctx) => <DataTypeFilter values={ctx.values} set={ctx.set} />,

	csvImport: {
		onImport: async (file): Promise<CsvImportResult> => {
			const res = await api().admin["product-characteristics"].import.post({
				file,
			});
			if (res.error)
				throw new Error(res.error.value?.message || "Errore durante l'import");
			const data = res.data?.data;
			if (!data) throw new Error("Risposta non valida dal server");
			return data;
		},
		title: "Importa Caratteristiche Prodotto",
		description:
			"Carica un file CSV per creare o correggere in blocco il dizionario.",
		formatHint:
			"Header attesi: name, data_type, unit, options (separate da |). Le voci già presenti vengono aggiornate; un cambio di tipo su una voce con valori viene rifiutato e va fatto da qui.",
	},

	labels: {
		searchPlaceholder: "Cerca caratteristica...",
		empty: {
			title: "Nessuna caratteristica trovata",
			subtitle: "Crea la prima caratteristica o importa il dizionario da CSV",
		},
		total: (n) => `Totale: ${n} caratteristic${n === 1 ? "a" : "he"}`,
		createDialog: {
			title: "Nuova Caratteristica",
			description:
				"Scegli nome e tipo. Le liste chiuse richiedono almeno un'opzione.",
		},
		editDialog: {
			title: "Modifica Caratteristica",
			description: "Modifica nome, tipo, unità e opzioni della caratteristica.",
		},
		deleteDescription: (name, e) =>
			e.valueCount > 0
				? `"${name}" ha valori su ${productsPhrase(e.valueCount)}: verranno eliminati definitivamente, insieme alla caratteristica e alle sue assegnazioni alle sotto-categorie.`
				: `Sei sicuro di voler eliminare la caratteristica "${name}"? Verrà tolta da tutte le sotto-categorie. Questa azione non può essere annullata.`,
		toasts: {
			createOk: "Caratteristica creata con successo",
			updateOk: "Caratteristica aggiornata con successo",
			deleteOk: "Caratteristica eliminata con successo",
		},
		rowAria: {
			edit: "Modifica caratteristica",
			delete: "Elimina caratteristica",
		},
	},
};
