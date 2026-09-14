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
					res.error.value?.message || "Failed to fetch store macro categories",
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
			aria-label="Filtra per macro categoria"
		>
			<NativeSelectOption value="">Tutte le macro categorie</NativeSelectOption>
			{macros.map((mc) => (
				<NativeSelectOption key={mc.id} value={mc.id}>
					{mc.name}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}

const macroColumn: DataTableColumnDef<StoreCategory> = {
	id: "macroCategory",
	header: "Macro Categoria",
	meta: { cellClassName: "text-muted-foreground" },
	cell: ({ row }) => row.original.macroCategory?.name ?? "—",
};

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

	extraColumns: [macroColumn],
	emptyIcon: <StoreIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <ConnectedStoreCategoryForm {...p} />,
	editDefaults: (e) => ({ name: e.name, macroCategoryId: e.macroCategoryId }),

	toolbarFilter: (ctx) => <MacroFilter values={ctx.values} set={ctx.set} />,

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
			"Carica un file CSV per popolare in blocco macro categorie e categorie negozio.",
		formatHint:
			"Header attesi: macro_category, name. L'import è idempotente: le categorie già presenti vengono saltate.",
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
			description:
				"Inserisci macro categoria e nome della nuova categoria negozio.",
		},
		editDialog: {
			title: "Modifica Categoria Negozio",
			description: "Modifica nome e macro della categoria selezionata.",
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
