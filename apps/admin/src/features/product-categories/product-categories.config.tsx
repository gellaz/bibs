import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { unwrap } from "@bibs/ui/lib/api-client";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useQuery } from "@tanstack/react-query";
import { TagsIcon } from "lucide-react";
import { CategoryCharacteristicsButton } from "@/features/category-characteristics/components/category-characteristics-button";
import type {
	CategoryCrudConfig,
	CrudFormProps,
} from "@/features/crud/category-crud-panel";
import type { CsvImportResult } from "@/features/csv-import/components/csv-import-dialog";
import { ProductCategoryForm } from "@/features/product-categories/components/product-category-form";
import type { ProductCategoryFormData } from "@/features/product-categories/schemas/product-category";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface MacroCategory {
	id: string;
	name: string;
}

interface ProductCategory {
	id: string;
	name: string;
	macroCategoryId: string;
	macroCategory: MacroCategory;
	characteristicCount: number;
	createdAt: Date | string;
}

// Shared macros query. TanStack Query dedupes by key, so the toolbar filter and
// the form fetch it exactly once (a single network request), like the old panel.
function useMacros() {
	const { data, isLoading } = useQuery({
		queryKey: ["product-macro-categories", "all"],
		queryFn: async () => {
			const res = await api()["product-macro-categories"].get({
				query: { limit: 100, sortBy: "name", sortOrder: "asc" },
			});
			return unwrap(res, m.categories_macros_load_error());
		},
		// Both the toolbar filter and the form mount their own observer of this
		// query; a stale time keeps the second mount (opening a dialog) from
		// refetching. Edits on the macro tab still refresh it: invalidating
		// ["product-macro-categories"] overrides staleTime.
		staleTime: 5 * 60 * 1000,
	});
	const macros: MacroCategory[] = data?.data ?? [];
	return { macros, isLoading };
}

function ConnectedProductCategoryForm(
	props: CrudFormProps<ProductCategoryFormData>,
) {
	const { macros, isLoading } = useMacros();
	return (
		<ProductCategoryForm {...props} macros={macros} macrosLoading={isLoading} />
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

const macroColumn = (): DataTableColumnDef<ProductCategory> => ({
	id: "macroCategory",
	header: m.categories_macro_column(),
	meta: { cellClassName: "text-muted-foreground" },
	cell: ({ row }) => row.original.macroCategory?.name ?? "—",
});

const characteristicsColumn = (): DataTableColumnDef<ProductCategory> => ({
	id: "characteristics",
	header: m.categories_product_characteristics_column(),
	meta: { menuLabel: m.categories_product_characteristics_column() },
	cell: ({ row }) => <CategoryCharacteristicsButton category={row.original} />,
});

export const productCategoriesConfig: CategoryCrudConfig<
	ProductCategory,
	ProductCategoryFormData
> = {
	queryKeyBase: "product-categories",
	storageKey: "admin.product-categories.columns",
	extraInvalidate: [["admin-configurations-counts"]],

	list: (q) =>
		api().admin["product-categories"].get({
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
		api().admin["product-categories"].post({
			name: form.name,
			macroCategoryId: form.macroCategoryId,
		}),
	update: (id, form) =>
		api()
			.admin["product-categories"]({ productCategoryId: id })
			.patch({ name: form.name, macroCategoryId: form.macroCategoryId }),
	remove: (id) =>
		api().admin["product-categories"]({ productCategoryId: id }).delete(),

	extraColumns: () => [macroColumn(), characteristicsColumn()],
	emptyIcon: <TagsIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <ConnectedProductCategoryForm {...p} />,
	editDefaults: (e) => ({ name: e.name, macroCategoryId: e.macroCategoryId }),

	toolbarFilter: (ctx) => <MacroFilter values={ctx.values} set={ctx.set} />,

	csvImport: {
		onImport: async (file): Promise<CsvImportResult> => {
			const res = await api().admin["product-categories"].import.post({ file });
			return unwrap(res, m.common_import_error()).data;
		},
		labels: () => ({
			title: m.categories_product_import_title(),
			description: m.categories_product_import_description(),
			// Le intestazioni sono quelle che l'API si aspetta: non si traducono.
			formatHint: m.categories_import_hint({
				headers: "macro_category, subcategory",
			}),
		}),
	},

	labels: () => ({
		searchPlaceholder: m.categories_product_search(),
		empty: {
			title: m.categories_product_empty(),
			subtitle: m.categories_product_empty_subtitle(),
		},
		total: (count) =>
			count === 1
				? m.categories_product_total_one({ count })
				: m.categories_product_total({ count }),
		createDialog: {
			title: m.categories_product_create_title(),
			description: m.categories_product_create_description(),
		},
		editDialog: {
			title: m.categories_product_edit_title(),
			description: m.categories_product_edit_description(),
		},
		deleteDescription: (name) =>
			m.categories_product_delete_description({ name }),
		toasts: {
			createOk: m.categories_product_created(),
			updateOk: m.categories_product_updated(),
			deleteOk: m.categories_product_deleted(),
		},
		rowAria: {
			edit: m.categories_product_edit_aria(),
			delete: m.categories_product_delete_aria(),
		},
	}),
};
