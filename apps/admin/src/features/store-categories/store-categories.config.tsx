import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useQuery } from "@tanstack/react-query";
import { StoreIcon } from "lucide-react";
import type {
	CategoryCrudConfig,
	CrudFormProps,
} from "@/features/crud/category-crud-panel";
import type { CsvImportResult } from "@/features/csv-import/components/csv-import-dialog";
import { StoreCategoryForm } from "@/features/store-categories/components/store-category-form";
import type { StoreCategoryFormData } from "@/features/store-categories/schemas/store-category";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface MacroCategory {
	id: string;
	name: string;
}

interface StoreCategory {
	id: string;
	name: string;
	macroCategoryId: string;
	macroCategory: MacroCategory;
	createdAt: Date | string;
}

// Shared macros query. TanStack Query dedupes by key, so the toolbar filter and
// the form fetch it exactly once. The stale time keeps opening a dialog (a
// second observer of the same query) from refetching.
function useMacros() {
	const { data, isLoading } = useQuery({
		queryKey: ["store-macro-categories", "all"],
		queryFn: async () => {
			const res = await api()["store-macro-categories"].get({
				query: { limit: 100, sortBy: "name", sortOrder: "asc" },
			});
			if (res.error)
				throw new Error(
					res.error.value?.message || m.categories_macros_load_error(),
				);
			return res.data;
		},
		staleTime: 5 * 60 * 1000,
	});
	const macros: MacroCategory[] = data?.data ?? [];
	return { macros, isLoading };
}

function ConnectedStoreCategoryForm(
	props: CrudFormProps<StoreCategoryFormData>,
) {
	const { macros, isLoading } = useMacros();
	return (
		<StoreCategoryForm {...props} macros={macros} macrosLoading={isLoading} />
	);
}

function MacroFilter({
	values,
	set,
}: {
	values: Record<string, string>;
	set: (key: string, value: string) => void;
}) {
	const { macros, isLoading } = useMacros();
	return (
		<NativeSelect
			className="w-56"
			value={values.macroCategoryId ?? ""}
			onChange={(e) => set("macroCategoryId", e.target.value)}
			disabled={isLoading}
			aria-label={m.categories_macro_filter_aria()}
		>
			<NativeSelectOption value="">
				{m.categories_macro_filter_all()}
			</NativeSelectOption>
			{macros.map((mc) => (
				<NativeSelectOption key={mc.id} value={mc.id}>
					{mc.name}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}

const macroColumn = (): DataTableColumnDef<StoreCategory> => ({
	id: "macroCategory",
	header: m.categories_macro_column(),
	meta: { cellClassName: "text-muted-foreground" },
	cell: ({ row }) => row.original.macroCategory?.name ?? "—",
});

export const storeCategoriesConfig: CategoryCrudConfig<
	StoreCategory,
	StoreCategoryFormData
> = {
	queryKeyBase: "store-categories",
	storageKey: "admin.store-categories.columns",
	extraInvalidate: [["admin-configurations-counts"]],

	list: (q) =>
		api()["store-categories"].get({
			query: {
				page: q.page,
				limit: q.limit,
				...(q.search ? { search: q.search } : {}),
				...(q.macroCategoryId
					? { macroCategoryId: q.macroCategoryId as string }
					: {}),
				sortBy: q.sortBy,
				sortOrder: q.sortOrder,
			},
		}),
	create: (form) =>
		api().admin["store-categories"].post({
			name: form.name,
			macroCategoryId: form.macroCategoryId,
		}),
	update: (id, form) =>
		api()
			.admin["store-categories"]({ categoryId: id })
			.patch({ name: form.name, macroCategoryId: form.macroCategoryId }),
	remove: (id) => api().admin["store-categories"]({ categoryId: id }).delete(),

	extraColumns: () => [macroColumn()],
	emptyIcon: <StoreIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <ConnectedStoreCategoryForm {...p} />,
	editDefaults: (e) => ({ name: e.name, macroCategoryId: e.macroCategoryId }),

	toolbarFilter: (ctx) => <MacroFilter values={ctx.values} set={ctx.set} />,

	csvImport: {
		onImport: async (file): Promise<CsvImportResult> => {
			const res = await api().admin["store-categories"].import.post({ file });
			if (res.error)
				throw new Error(res.error.value?.message || m.common_import_error());
			const data = res.data?.data;
			if (!data) throw new Error(m.csv_invalid_response());
			return data;
		},
		labels: () => ({
			title: m.categories_store_import_title(),
			description: m.categories_store_import_description(),
			// Le intestazioni sono quelle che l'API si aspetta: non si traducono.
			formatHint: m.categories_import_hint({ headers: "macro_category, name" }),
		}),
	},

	labels: () => ({
		searchPlaceholder: m.categories_store_search(),
		empty: {
			title: m.categories_store_empty(),
			subtitle: m.categories_store_empty_subtitle(),
		},
		total: (count) =>
			count === 1
				? m.categories_store_total_one({ count })
				: m.categories_store_total({ count }),
		createDialog: {
			title: m.categories_store_create_title(),
			description: m.categories_store_create_description(),
		},
		editDialog: {
			title: m.categories_store_edit_title(),
			description: m.categories_store_edit_description(),
		},
		deleteDescription: (name) =>
			m.categories_store_delete_description({ name }),
		toasts: {
			createOk: m.categories_store_created(),
			updateOk: m.categories_store_updated(),
			deleteOk: m.categories_store_deleted(),
		},
		rowAria: {
			edit: m.categories_store_edit_aria(),
			delete: m.categories_store_delete_aria(),
		},
	}),
};
