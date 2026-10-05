import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { unwrap } from "@bibs/ui/lib/api-client";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { ListChecksIcon } from "lucide-react";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
import type { CsvImportResult } from "@/features/csv-import/components/csv-import-dialog";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";
import { ProductCharacteristicForm } from "./components/product-characteristic-form";
import {
	CHARACTERISTIC_DATA_TYPES,
	type CharacteristicDataType,
	dataTypeLabel,
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

const extraColumns = (): DataTableColumnDef<ProductCharacteristic>[] => [
	{
		id: "dataType",
		header: m.common_type(),
		meta: { cellClassName: "text-muted-foreground" },
		cell: ({ row }) => dataTypeLabel(row.original.dataType),
	},
	{
		id: "unit",
		header: m.characteristics_column_unit(),
		meta: { cellClassName: "text-muted-foreground" },
		cell: ({ row }) => row.original.unit ?? "—",
	},
	{
		id: "options",
		header: m.characteristics_column_options(),
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
			aria-label={m.characteristics_filter_type()}
		>
			<NativeSelectOption value="">
				{m.characteristics_all_types()}
			</NativeSelectOption>
			{CHARACTERISTIC_DATA_TYPES.map((d) => (
				<NativeSelectOption key={d} value={d}>
					{dataTypeLabel(d)}
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
	// cancellazione dal dizionario porta via in cascata; il pannello matrice di
	// ogni sotto-categoria mostra le stesse voci e i loro valueCount.
	extraInvalidate: [
		["admin-configurations-counts"],
		["product-categories"],
		["admin-category-characteristics"],
	],

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
			return unwrap(res, m.common_import_error()).data;
		},
		labels: () => ({
			title: m.characteristics_import_title(),
			description: m.characteristics_import_description(),
			formatHint: m.characteristics_import_hint(),
		}),
	},

	labels: () => ({
		searchPlaceholder: m.characteristics_search(),
		empty: {
			title: m.characteristics_empty_title(),
			subtitle: m.characteristics_empty_subtitle(),
		},
		total: (count) =>
			count === 1
				? m.characteristics_total_one({ count })
				: m.characteristics_total({ count }),
		createDialog: {
			title: m.configurations_new_characteristic(),
			description: m.characteristics_create_description(),
		},
		editDialog: {
			title: m.characteristics_edit_title(),
			description: m.characteristics_edit_description(),
		},
		deleteDescription: (name, e) => {
			const count = e.valueCount;
			if (count === 0) return m.characteristics_delete_description({ name });
			return count === 1
				? m.characteristics_delete_with_values_one({ name, count })
				: m.characteristics_delete_with_values({ name, count });
		},
		toasts: {
			createOk: m.characteristics_create_ok(),
			updateOk: m.characteristics_update_ok(),
			deleteOk: m.characteristics_delete_ok(),
		},
		rowAria: {
			edit: m.characteristics_edit_aria(),
			delete: m.characteristics_delete_aria(),
		},
	}),
};
