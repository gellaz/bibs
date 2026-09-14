import { LayersIcon } from "lucide-react";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
import { StoreMacroCategoryForm } from "@/features/store-macro-categories/components/store-macro-category-form";
import type { StoreMacroCategoryFormData } from "@/features/store-macro-categories/schemas/store-macro-category";
import { api } from "@/lib/api";

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

	labels: {
		searchPlaceholder: "Cerca macro categoria negozio...",
		empty: {
			title: "Nessuna macro categoria negozio trovata",
			subtitle: "Crea la prima macro categoria per iniziare",
		},
		total: (n) => `Totale: ${n} macro categori${n === 1 ? "a" : "e"}`,
		createDialog: {
			title: "Nuova Macro Categoria Negozio",
			description: "Inserisci il nome della nuova macro categoria negozio.",
		},
		editDialog: {
			title: "Modifica Macro Categoria Negozio",
			description: "Modifica il nome della macro categoria selezionata.",
		},
		deleteDescription: (name) =>
			`Sei sicuro di voler eliminare la macro categoria "${name}"? L'eliminazione fallirà se ci sono ancora categorie collegate.`,
		toasts: {
			createOk: "Macro categoria negozio creata con successo",
			updateOk: "Macro categoria negozio aggiornata con successo",
			deleteOk: "Macro categoria negozio eliminata con successo",
		},
		rowAria: {
			edit: "Modifica macro categoria",
			delete: "Elimina macro categoria",
		},
	},
};
