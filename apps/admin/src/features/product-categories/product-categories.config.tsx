import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { TagsIcon } from "lucide-react";
import type {
	CategoryCrudConfig,
	CrudFormProps,
} from "@/features/crud/category-crud-panel";
import type { CsvImportResult } from "@/features/csv-import/components/csv-import-dialog";
import { ProductCategoryForm } from "@/features/product-categories/components/product-category-form";
import type { ProductCategoryFormData } from "@/features/product-categories/schemas/product-category";
import { api } from "@/lib/api";

interface MacroCategory {
	id: string;
	name: string;
}

interface ProductCategory {
	id: string;
	name: string;
	macroCategoryId: string;
	macroCategory: MacroCategory;
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
			if (res.error)
				throw new Error(
					res.error.value?.message || "Failed to fetch macro categories",
				);
			return res.data;
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
			aria-label="Filtra per macro categoria"
		>
			<NativeSelectOption value="">Tutte le macro categorie</NativeSelectOption>
			{macros.map((m) => (
				<NativeSelectOption key={m.id} value={m.id}>
					{m.name}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}

const macroColumn: ColumnDef<ProductCategory> = {
	id: "macroCategory",
	header: "Macro Categoria",
	meta: { cellClassName: "text-muted-foreground" },
	cell: ({ row }) => row.original.macroCategory?.name ?? "—",
};

export const productCategoriesConfig: CategoryCrudConfig<
	ProductCategory,
	ProductCategoryFormData
> = {
	queryKeyBase: "product-categories",
	storageKey: "admin.product-categories.columns",
	extraInvalidate: [["admin-configurations-counts"]],

	list: (q) =>
		api()["product-categories"].get({
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

	extraColumns: [macroColumn],
	emptyIcon: <TagsIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <ConnectedProductCategoryForm {...p} />,
	editDefaults: (e) => ({ name: e.name, macroCategoryId: e.macroCategoryId }),

	toolbarFilter: (ctx) => <MacroFilter values={ctx.values} set={ctx.set} />,

	csvImport: {
		onImport: async (file): Promise<CsvImportResult> => {
			const res = await api().admin["product-categories"].import.post({ file });
			if (res.error)
				throw new Error(res.error.value?.message || "Errore durante l'import");
			const data = res.data?.data;
			if (!data) throw new Error("Risposta non valida dal server");
			return data;
		},
		title: "Importa Categorie Prodotto",
		description:
			"Carica un file CSV per popolare in blocco macro categorie e sotto-categorie.",
		formatHint:
			"Header attesi: macro_category, subcategory. L'import è idempotente: le categorie già presenti vengono saltate.",
	},

	labels: {
		searchPlaceholder: "Cerca categoria prodotto...",
		empty: {
			title: "Nessuna categoria prodotto trovata",
			subtitle: "Crea la prima categoria prodotto per iniziare",
		},
		total: (n) => `Totale: ${n} categori${n === 1 ? "a" : "e"} prodotto`,
		createDialog: {
			title: "Nuova Categoria Prodotto",
			description:
				"Inserisci macro categoria e nome della nuova sotto-categoria.",
		},
		editDialog: {
			title: "Modifica Categoria Prodotto",
			description: "Modifica nome e macro della sotto-categoria selezionata.",
		},
		deleteDescription: (name) =>
			`Sei sicuro di voler eliminare la categoria prodotto "${name}"? Questa azione non può essere annullata.`,
		toasts: {
			createOk: "Categoria prodotto creata con successo",
			updateOk: "Categoria prodotto aggiornata con successo",
			deleteOk: "Categoria prodotto eliminata con successo",
		},
		rowAria: {
			edit: "Modifica categoria prodotto",
			delete: "Elimina categoria prodotto",
		},
	},
};
