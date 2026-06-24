import type { ColumnDef } from "@tanstack/react-table";
import { LayersIcon } from "lucide-react";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
import { ProductMacroCategoryForm } from "@/features/product-macro-categories/components/product-macro-category-form";
import type { ProductMacroCategoryFormData } from "@/features/product-macro-categories/schemas/product-macro-category";
import { api } from "@/lib/api";

interface ProductMacroCategory {
	id: string;
	name: string;
	suggestedVatRate: ProductMacroCategoryFormData["suggestedVatRate"];
	createdAt: Date | string;
}

const vatColumn: ColumnDef<ProductMacroCategory> = {
	id: "suggestedVatRate",
	header: "IVA suggerita",
	meta: { menuLabel: "IVA suggerita", cellClassName: "text-sm tabular-nums" },
	cell: ({ row }) => `${row.original.suggestedVatRate}%`,
};

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

	extraColumns: [vatColumn],
	emptyIcon: <LayersIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <ProductMacroCategoryForm {...p} />,
	editDefaults: (e) => ({ name: e.name, suggestedVatRate: e.suggestedVatRate }),

	labels: {
		searchPlaceholder: "Cerca macro categoria...",
		empty: {
			title: "Nessuna macro categoria trovata",
			subtitle: "Crea la prima macro categoria per iniziare",
		},
		total: (n) => `Totale: ${n} macro categori${n === 1 ? "a" : "e"}`,
		createDialog: {
			title: "Nuova Macro Categoria Prodotto",
			description: "Inserisci il nome della nuova macro categoria prodotto.",
		},
		editDialog: {
			title: "Modifica Macro Categoria Prodotto",
			description: "Modifica il nome della macro categoria selezionata.",
		},
		deleteDescription: (name) =>
			`Sei sicuro di voler eliminare la macro categoria "${name}"? L'eliminazione fallirà se ci sono ancora sotto-categorie collegate.`,
		toasts: {
			createOk: "Macro categoria prodotto creata con successo",
			updateOk: "Macro categoria prodotto aggiornata con successo",
			deleteOk: "Macro categoria prodotto eliminata con successo",
		},
		rowAria: {
			edit: "Modifica macro categoria",
			delete: "Elimina macro categoria",
		},
	},
};
