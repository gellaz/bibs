import { LayersIcon } from "lucide-react";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
import { StoreMacroCategoryForm } from "@/features/store-macro-categories/components/store-macro-category-form";
import type { StoreMacroCategoryFormData } from "@/features/store-macro-categories/schemas/store-macro-category";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface StoreMacroCategory {
	id: string;
	name: string;
	createdAt: Date | string;
}

export const storeMacroCategoriesConfig: CategoryCrudConfig<
	StoreMacroCategory,
	StoreMacroCategoryFormData
> = {
	queryKeyBase: "store-macro-categories",
	storageKey: "admin.store-macro-categories.columns",
	extraInvalidate: [["store-categories"], ["admin-configurations-counts"]],

	list: (q) =>
		api()["store-macro-categories"].get({
			query: {
				page: q.page,
				limit: q.limit,
				...(q.search ? { search: q.search } : {}),
				sortBy: q.sortBy,
				sortOrder: q.sortOrder,
			},
		}),
	create: (form) =>
		api().admin["store-macro-categories"].post({ name: form.name }),
	update: (id, form) =>
		api()
			.admin["store-macro-categories"]({ macroCategoryId: id })
			.patch({ name: form.name }),
	remove: (id) =>
		api().admin["store-macro-categories"]({ macroCategoryId: id }).delete(),

	emptyIcon: <LayersIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <StoreMacroCategoryForm {...p} />,
	editDefaults: (e) => ({ name: e.name }),

	labels: () => ({
		searchPlaceholder: m.categories_store_macro_search(),
		empty: {
			title: m.categories_store_macro_empty(),
			subtitle: m.categories_macro_empty_subtitle(),
		},
		total: (count) =>
			count === 1
				? m.categories_macro_total_one({ count })
				: m.categories_macro_total({ count }),
		createDialog: {
			title: m.categories_store_macro_create_title(),
			description: m.categories_store_macro_create_description(),
		},
		editDialog: {
			title: m.categories_store_macro_edit_title(),
			description: m.categories_macro_edit_description(),
		},
		deleteDescription: (name) =>
			m.categories_store_macro_delete_description({ name }),
		toasts: {
			createOk: m.categories_store_macro_created(),
			updateOk: m.categories_store_macro_updated(),
			deleteOk: m.categories_store_macro_deleted(),
		},
		rowAria: {
			edit: m.categories_macro_edit_aria(),
			delete: m.categories_macro_delete_aria(),
		},
	}),
};
