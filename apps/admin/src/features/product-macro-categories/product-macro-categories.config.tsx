import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { LayersIcon } from "lucide-react";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
import { ProductMacroCategoryForm } from "@/features/product-macro-categories/components/product-macro-category-form";
import type { ProductMacroCategoryFormData } from "@/features/product-macro-categories/schemas/product-macro-category";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface ProductMacroCategory {
	id: string;
	name: string;
	suggestedVatRate: ProductMacroCategoryFormData["suggestedVatRate"];
	createdAt: Date | string;
}

const vatColumn = (): DataTableColumnDef<ProductMacroCategory> => ({
	id: "suggestedVatRate",
	header: m.categories_product_macro_vat_column(),
	meta: {
		menuLabel: m.categories_product_macro_vat_column(),
		cellClassName: "text-sm tabular-nums",
	},
	cell: ({ row }) => `${row.original.suggestedVatRate}%`,
});

export const productMacroCategoriesConfig: CategoryCrudConfig<
	ProductMacroCategory,
	ProductMacroCategoryFormData
> = {
	queryKeyBase: "product-macro-categories",
	storageKey: "admin.product-macro-categories.columns",
	extraInvalidate: [["product-categories"], ["admin-configurations-counts"]],

	list: (q) =>
		api()["product-macro-categories"].get({
			query: {
				page: q.page,
				limit: q.limit,
				...(q.search ? { search: q.search } : {}),
				sortBy: q.sortBy,
				sortOrder: q.sortOrder,
			},
		}),
	create: (form) =>
		api().admin["product-macro-categories"].post({
			name: form.name,
			suggestedVatRate: form.suggestedVatRate,
		}),
	update: (id, form) =>
		api()
			.admin["product-macro-categories"]({ macroCategoryId: id })
			.patch({ name: form.name, suggestedVatRate: form.suggestedVatRate }),
	remove: (id) =>
		api().admin["product-macro-categories"]({ macroCategoryId: id }).delete(),

	extraColumns: () => [vatColumn()],
	emptyIcon: <LayersIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <ProductMacroCategoryForm {...p} />,
	editDefaults: (e) => ({ name: e.name, suggestedVatRate: e.suggestedVatRate }),

	labels: () => ({
		searchPlaceholder: m.categories_product_macro_search(),
		empty: {
			title: m.categories_product_macro_empty(),
			subtitle: m.categories_macro_empty_subtitle(),
		},
		total: (count) =>
			count === 1
				? m.categories_macro_total_one({ count })
				: m.categories_macro_total({ count }),
		createDialog: {
			title: m.categories_product_macro_create_title(),
			description: m.categories_product_macro_create_description(),
		},
		editDialog: {
			title: m.categories_product_macro_edit_title(),
			description: m.categories_macro_edit_description(),
		},
		deleteDescription: (name) =>
			m.categories_product_macro_delete_description({ name }),
		toasts: {
			createOk: m.categories_product_macro_created(),
			updateOk: m.categories_product_macro_updated(),
			deleteOk: m.categories_product_macro_deleted(),
		},
		rowAria: {
			edit: m.categories_macro_edit_aria(),
			delete: m.categories_macro_delete_aria(),
		},
	}),
};
