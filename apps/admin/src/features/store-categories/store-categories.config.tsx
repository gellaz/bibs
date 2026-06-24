import { StoreIcon } from "lucide-react";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
import type { CsvImportResult } from "@/features/csv-import/components/csv-import-dialog";
import { StoreCategoryForm } from "@/features/store-categories/components/store-category-form";
import type { StoreCategoryFormData } from "@/features/store-categories/schemas/store-category";
import { api } from "@/lib/api";

interface StoreCategory {
	id: string;
	name: string;
	createdAt: Date | string;
}

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
				sortBy: q.sortBy,
				sortOrder: q.sortOrder,
			},
		}),
	create: (form) => api().admin["store-categories"].post({ name: form.name }),
	update: (id, form) =>
		api().admin["store-categories"]({ categoryId: id }).patch({
			name: form.name,
		}),
	remove: (id) => api().admin["store-categories"]({ categoryId: id }).delete(),

	emptyIcon: <StoreIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <StoreCategoryForm {...p} />,
	editDefaults: (e) => ({ name: e.name }),

	csvImport: {
		onImport: async (file): Promise<CsvImportResult> => {
			const res = await api().admin["store-categories"].import.post({ file });
			if (res.error)
				throw new Error(res.error.value?.message || "Errore durante l'import");
			const data = res.data?.data;
			if (!data) throw new Error("Risposta non valida dal server");
			return data;
		},
		title: "Importa Categorie Negozio",
		description:
			"Carica un file CSV per popolare in blocco le categorie negozio.",
		formatHint:
			"Header atteso: name. L'import è idempotente: le categorie già presenti vengono saltate.",
	},

	labels: {
		searchPlaceholder: "Cerca categoria negozio...",
		empty: {
			title: "Nessuna categoria negozio trovata",
			subtitle: "Crea la prima categoria per iniziare",
		},
		total: (n) => `Totale: ${n} categori${n === 1 ? "a" : "e"}`,
		createDialog: {
			title: "Nuova Categoria Negozio",
			description: "Inserisci il nome della nuova categoria negozio.",
		},
		editDialog: {
			title: "Modifica Categoria Negozio",
			description: "Modifica il nome della categoria selezionata.",
		},
		deleteDescription: (name) =>
			`Sei sicuro di voler eliminare la categoria "${name}"? Questa azione non può essere annullata.`,
		toasts: {
			createOk: "Categoria negozio creata con successo",
			updateOk: "Categoria negozio aggiornata con successo",
			deleteOk: "Categoria negozio eliminata con successo",
		},
		rowAria: { edit: "Modifica categoria", delete: "Elimina categoria" },
	},
};
