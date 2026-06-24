# Generic CategoryCrudPanel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three near-identical admin category CRUD panels (store-categories, product-macro-categories, product-categories) into one config-driven `CategoryCrudPanel<TEntity, TForm>`, preserving behavior. Holidays stays standalone.

**Architecture:** A single generic component owns the entire CRUD skeleton (paginated/debounced/sortable list query, create/update/delete mutations, columns, toolbar, dialogs, central Eden unwrap). Each entity supplies a thin config object: typed data closures (closing over the concrete `api.x.y` calls, since Eden is statically typed per-path with divergent route-param names), the existing per-entity `*-form.tsx` as a render slot, extra columns, labels, and optional CSV/filter slots.

**Tech Stack:** TanStack Start/Router/Query, `@elysiajs/eden` treaty client, `@bibs/ui` (DataTable, dialogs, sortable head, useDebouncedValue), react-hook-form + zod (unchanged forms), Tailwind.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-24-category-crud-panel-design.md`.
- **Branch:** `refactor/category-crud-panel` (already created).
- **`"use no memo"`** MUST be the first statement in the generic component (TanStack Table + React Compiler; per repo memory).
- **Eden closures only** — never pass path strings/nodes into the generic; route-param keys are `categoryId` / `macroCategoryId` / `productCategoryId`; lists read the unqualified route, writes go through `api().admin[...]`.
- **Keep all Italian copy verbatim** (singular/plural irregular: `categori{a|e}`, append ` prodotto`, prefix `macro `). Badge singular / list plural convention.
- **Forms untouched** — do not edit the three `*-form.tsx` or their `schemas/*.ts`. The generic keys the edit form by `selected.id` to remount per target (avoids the flagged RHF `reset` clobber).
- **Toasts** via `@bibs/ui/components/sonner` (never `from "sonner"`).
- **Verification is type + build + browser smoke**, not unit TDD — admin has no FE test harness and the approved spec chose this. Each task's gate is `bun run --filter @bibs/admin typecheck` (check `$?`, never trust aggregate output) plus build/smoke where noted.
- **No new routes added** → `routeTree.gen.ts` is unaffected (no commit of it needed).
- **PR-first**: commit per task on the feature branch; never on main.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `apps/admin/src/features/crud/category-crud-panel.tsx` | Generic component + `CategoryCrudConfig` type + Eden unwrap | Create |
| `apps/admin/src/features/store-categories/store-categories.config.tsx` | store config (name-only form, CSV) | Create |
| `apps/admin/src/features/product-macro-categories/product-macro-categories.config.tsx` | macro config (vat column + Select form, 3-key invalidate, no CSV) | Create |
| `apps/admin/src/features/product-categories/product-categories.config.tsx` | product config (macro filter slot + relation column + macros-connected form + CSV) | Create |
| `apps/admin/src/routes/_authenticated/configurations.tsx` | route — render `<CategoryCrudPanel>` per tab | Modify |
| `…/store-categories/components/store-categories-panel.tsx` | (old panel) | Delete |
| `…/product-macro-categories/components/product-macro-categories-panel.tsx` | (old panel) | Delete |
| `…/product-categories/components/product-categories-panel.tsx` | (old panel) | Delete |

Unchanged: the three `*-form.tsx`, the three `schemas/*.ts`, `csv-import/components/csv-import-dialog.tsx`, the whole `holidays/` feature.

---

## Task 1: Generic `CategoryCrudPanel` component + config type

**Files:**
- Create: `apps/admin/src/features/crud/category-crud-panel.tsx`

**Interfaces:**
- Produces: `CategoryCrudPanel<TEntity, TForm>` (default export-free named export); type `CategoryCrudConfig<TEntity extends CategoryEntity, TForm>`; types `CategoryEntity`, `CrudListResult<T>`, `CrudListQuery`, `CrudFormProps<TForm>`.
- Consumes: `@bibs/ui/*`, `@bibs/ui/hooks/use-debounced-value`, `CsvImportDialog`+`CsvImportResult` from `@/features/csv-import/components/csv-import-dialog`.

- [ ] **Step 1: Create the component file with full implementation**

Create `apps/admin/src/features/crud/category-crud-panel.tsx`:

```tsx
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { DataTable } from "@bibs/ui/components/data-table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import { toast } from "@bibs/ui/components/sonner";
import type { SortOrder } from "@bibs/ui/components/sortable-table-head";
import { SortableHeadButton } from "@bibs/ui/components/sortable-table-head";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { useDebouncedValue } from "@bibs/ui/hooks/use-debounced-value";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { PencilIcon, SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
	CsvImportDialog,
	type CsvImportResult,
} from "@/features/csv-import/components/csv-import-dialog";

type SortByField = "name" | "createdAt";

const DATE_FMT_OPTS: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "long",
	day: "numeric",
};

const EMPTY: never[] = [];

// Eden responses are { data, error }. error shape is per-route; keep it `unknown`
// so any config closure's eden promise is assignable, and narrow at runtime.
type EdenRes<T> = { data: T | null; error: unknown };

function edenMessage(error: unknown): string | undefined {
	if (error && typeof error === "object" && "value" in error) {
		const v = (error as { value?: unknown }).value;
		if (typeof v === "string") return v;
		if (v && typeof v === "object" && "message" in v) {
			const m = (v as { message?: unknown }).message;
			if (typeof m === "string") return m;
		}
	}
	return undefined;
}

async function unwrap<T>(
	p: Promise<EdenRes<T>>,
	fallback: string,
): Promise<T> {
	const res = await p;
	if (res.error) throw new Error(edenMessage(res.error) ?? fallback);
	if (res.data == null) throw new Error(fallback);
	return res.data;
}

export interface CategoryEntity {
	id: string;
	name: string;
	createdAt: Date | string;
}

export interface CrudListResult<T> {
	data: T[];
	pagination: { total: number };
}

export interface CrudListQuery {
	page: number;
	limit: number;
	search?: string;
	sortBy: SortByField;
	sortOrder: SortOrder;
	[filterKey: string]: string | number | undefined;
}

export interface CrudFormProps<TForm> {
	defaultValues?: TForm;
	onSubmit: (data: TForm) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export interface CategoryCrudConfig<TEntity extends CategoryEntity, TForm> {
	queryKeyBase: string;
	storageKey: string;
	extraInvalidate?: readonly (readonly string[])[];

	list: (q: CrudListQuery) => Promise<EdenRes<CrudListResult<TEntity>>>;
	create: (form: TForm) => Promise<EdenRes<unknown>>;
	update: (id: string, form: TForm) => Promise<EdenRes<unknown>>;
	remove: (id: string) => Promise<EdenRes<unknown>>;

	extraColumns?: ColumnDef<TEntity>[];
	emptyIcon: ReactNode;

	renderForm: (p: CrudFormProps<TForm>) => ReactNode;
	editDefaults: (e: TEntity) => TForm;

	toolbarFilter?: (ctx: {
		values: Record<string, string>;
		set: (key: string, value: string) => void;
	}) => ReactNode;
	csvImport?: {
		onImport: (file: File) => Promise<CsvImportResult>;
		title: string;
		description: string;
		formatHint: string;
	};

	labels: {
		searchPlaceholder: string;
		empty: { title: string; subtitle: string };
		total: (n: number) => string;
		createDialog: { title: string; description: string };
		editDialog: { title: string; description: string };
		deleteDescription: (name: string) => ReactNode;
		toasts: { createOk: string; updateOk: string; deleteOk: string };
		rowAria: { edit: string; delete: string };
	};
}

interface CategoryCrudPanelProps<TEntity extends CategoryEntity, TForm> {
	config: CategoryCrudConfig<TEntity, TForm>;
	createOpen: boolean;
	onCreateOpenChange: (open: boolean) => void;
}

export function CategoryCrudPanel<TEntity extends CategoryEntity, TForm>({
	config,
	createOpen,
	onCreateOpenChange,
}: CategoryCrudPanelProps<TEntity, TForm>) {
	"use no memo";

	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [sortBy, setSortBy] = useState<SortByField>("name");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
	const [filterValues, setFilterValues] = useState<Record<string, string>>({});
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	const [selected, setSelected] = useState<TEntity | null>(null);

	const handleSort = (field: SortByField) => {
		if (sortBy === field) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(field);
			setSortOrder("asc");
		}
		setPage(1);
	};

	const setFilterValue = (key: string, value: string) => {
		setFilterValues((prev) => ({ ...prev, [key]: value }));
		setPage(1);
	};

	const activeFilters = useMemo(() => {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(filterValues)) if (v) out[k] = v;
		return out;
	}, [filterValues]);

	const { data, isLoading, error } = useQuery({
		queryKey: [
			config.queryKeyBase,
			page,
			limit,
			debouncedSearch,
			sortBy,
			sortOrder,
			activeFilters,
		],
		queryFn: () =>
			unwrap(
				config.list({
					page,
					limit,
					...(debouncedSearch ? { search: debouncedSearch } : {}),
					sortBy,
					sortOrder,
					...activeFilters,
				}),
				"Errore nel caricamento dei dati",
			),
	});

	const invalidateAll = () => {
		void queryClient.invalidateQueries({ queryKey: [config.queryKeyBase] });
		for (const key of config.extraInvalidate ?? []) {
			void queryClient.invalidateQueries({ queryKey: [...key] });
		}
	};

	const createMutation = useMutation({
		mutationFn: (form: TForm) =>
			unwrap(config.create(form), "Errore durante la creazione"),
		onSuccess: () => {
			invalidateAll();
			onCreateOpenChange(false);
			toast.success(config.labels.toasts.createOk);
		},
		onError: (e: Error) =>
			toast.error(e.message || "Errore durante la creazione"),
	});

	const updateMutation = useMutation({
		mutationFn: ({ id, form }: { id: string; form: TForm }) =>
			unwrap(config.update(id, form), "Errore durante l'aggiornamento"),
		onSuccess: () => {
			invalidateAll();
			setEditOpen(false);
			setSelected(null);
			toast.success(config.labels.toasts.updateOk);
		},
		onError: (e: Error) =>
			toast.error(e.message || "Errore durante l'aggiornamento"),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) =>
			unwrap(config.remove(id), "Errore durante l'eliminazione"),
		onSuccess: () => {
			invalidateAll();
			setDeleteOpen(false);
			setSelected(null);
			toast.success(config.labels.toasts.deleteOk);
		},
		onError: (e: Error) =>
			toast.error(e.message || "Errore durante l'eliminazione"),
	});

	const handleDelete = () => {
		if (!selected) return;
		deleteMutation.mutate(selected.id);
	};

	const columns = useMemo<ColumnDef<TEntity>[]>(() => {
		const nameCol: ColumnDef<TEntity> = {
			id: "name",
			enableHiding: false,
			meta: {
				menuLabel: "Nome",
				headerClassName: "pl-4",
				cellClassName: "pl-6 font-semibold",
			},
			header: () => (
				<SortableHeadButton
					active={sortBy === "name"}
					sortOrder={sortOrder}
					onSort={() => handleSort("name")}
				>
					Nome
				</SortableHeadButton>
			),
			cell: ({ row }) => row.original.name,
		};
		const createdAtCol: ColumnDef<TEntity> = {
			id: "createdAt",
			meta: {
				menuLabel: "Data creazione",
				cellClassName: "text-muted-foreground text-sm",
			},
			header: () => (
				<SortableHeadButton
					active={sortBy === "createdAt"}
					sortOrder={sortOrder}
					onSort={() => handleSort("createdAt")}
				>
					Data Creazione
				</SortableHeadButton>
			),
			cell: ({ row }) =>
				new Date(row.original.createdAt).toLocaleDateString(
					"it-IT",
					DATE_FMT_OPTS,
				),
		};
		const actionsCol: ColumnDef<TEntity> = {
			id: "actions",
			enableHiding: false,
			meta: {
				headerClassName: "pr-6 text-right",
				cellClassName: "pr-6 text-right",
			},
			header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
			cell: ({ row }) => (
				<div className="flex items-center justify-end gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => {
							setSelected(row.original);
							setEditOpen(true);
						}}
						aria-label={config.labels.rowAria.edit}
					>
						<PencilIcon className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => {
							setSelected(row.original);
							setDeleteOpen(true);
						}}
						aria-label={config.labels.rowAria.delete}
					>
						<Trash2Icon className="size-4" />
					</Button>
				</div>
			),
		};
		return [nameCol, ...(config.extraColumns ?? []), createdAtCol, actionsCol];
	}, [sortBy, sortOrder, config]);

	const rows = data?.data ?? EMPTY;

	return (
		<div className="space-y-4">
			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
					<Input
						placeholder={config.labels.searchPlaceholder}
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(1);
						}}
						className="pl-9"
					/>
				</div>
				{config.toolbarFilter?.({ values: filterValues, set: setFilterValue })}
				{config.csvImport && (
					<Button variant="outline" onClick={() => setImportOpen(true)}>
						<UploadIcon />
						<span>Importa CSV</span>
					</Button>
				)}
			</div>

			<DataTable
				data={rows}
				columns={columns}
				storageKey={config.storageKey}
				getRowId={(row) => row.id}
				isLoading={isLoading}
				emptyState={
					<div className="flex flex-col items-center gap-2">
						{config.emptyIcon}
						<div>
							<p className="text-muted-foreground font-medium">
								{config.labels.empty.title}
							</p>
							<p className="text-muted-foreground/60 text-sm">
								{config.labels.empty.subtitle}
							</p>
						</div>
					</div>
				}
			/>

			{data?.pagination && data.pagination.total > 0 && (
				<div className="flex items-center justify-between">
					<div className="text-muted-foreground text-sm">
						{config.labels.total(data.pagination.total)}
					</div>
					<div className="flex items-center gap-4">
						<PageSizeSelector
							pageSize={limit}
							onPageSizeChange={(size) => {
								setLimit(size);
								setPage(1);
							}}
						/>
						<DataPagination
							page={page}
							totalPages={Math.ceil(data.pagination.total / limit)}
							onPageChange={setPage}
						/>
					</div>
				</div>
			)}

			<Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{config.labels.createDialog.title}</DialogTitle>
						<DialogDescription>
							{config.labels.createDialog.description}
						</DialogDescription>
					</DialogHeader>
					{config.renderForm({
						onSubmit: (form) => createMutation.mutate(form),
						onCancel: () => onCreateOpenChange(false),
						isPending: createMutation.isPending,
						submitLabel: "Crea",
						pendingLabel: "Creazione...",
					})}
				</DialogContent>
			</Dialog>

			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{config.labels.editDialog.title}</DialogTitle>
						<DialogDescription>
							{config.labels.editDialog.description}
						</DialogDescription>
					</DialogHeader>
					{selected && (
						<div key={selected.id}>
							{config.renderForm({
								defaultValues: config.editDefaults(selected),
								onSubmit: (form) =>
									updateMutation.mutate({ id: selected.id, form }),
								onCancel: () => {
									setEditOpen(false);
									setSelected(null);
								},
								isPending: updateMutation.isPending,
								submitLabel: "Salva",
								pendingLabel: "Salvataggio...",
							})}
						</div>
					)}
				</DialogContent>
			</Dialog>

			{config.csvImport && (
				<CsvImportDialog
					open={importOpen}
					onOpenChange={setImportOpen}
					title={config.csvImport.title}
					description={config.csvImport.description}
					formatHint={config.csvImport.formatHint}
					onImport={config.csvImport.onImport}
					onSuccess={invalidateAll}
				/>
			)}

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Conferma eliminazione</AlertDialogTitle>
						<AlertDialogDescription>
							{selected ? config.labels.deleteDescription(selected.name) : null}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setDeleteOpen(false);
								setSelected(null);
							}}
						>
							Annulla
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={handleDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
```

- [ ] **Step 2: Typecheck the new file**

Run: `bun run --filter @bibs/admin typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`. If the `ColumnMeta` keys (`menuLabel`/`headerClassName`/`cellClassName`) error, confirm the project-wide `@tanstack/react-table` `ColumnMeta` augmentation is in scope (it is used by every existing panel; same import graph). If `useDebouncedValue` path errors, verify `packages/ui/src/hooks/use-debounced-value.ts` export.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/crud/category-crud-panel.tsx
git commit -m "feat(admin): generic CategoryCrudPanel + config type"
```

---

## Task 2: Migrate store-categories (simplest — de-risks the generic)

**Files:**
- Create: `apps/admin/src/features/store-categories/store-categories.config.tsx`
- Modify: `apps/admin/src/routes/_authenticated/configurations.tsx`
- Delete: `apps/admin/src/features/store-categories/components/store-categories-panel.tsx`

**Interfaces:**
- Consumes: `CategoryCrudConfig` (Task 1); `StoreCategoryForm` + `StoreCategoryFormData` (unchanged); `CsvImportResult`; `api`.
- Produces: `storeCategoriesConfig`.

- [ ] **Step 1: Create the config**

Create `apps/admin/src/features/store-categories/store-categories.config.tsx`:

```tsx
import { StoreIcon } from "lucide-react";
import type { CsvImportResult } from "@/features/csv-import/components/csv-import-dialog";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
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
```

- [ ] **Step 2: Wire the route's store-categories branch**

In `apps/admin/src/routes/_authenticated/configurations.tsx`: add imports
```tsx
import { CategoryCrudPanel } from "@/features/crud/category-crud-panel";
import { storeCategoriesConfig } from "@/features/store-categories/store-categories.config";
```
remove `import { StoreCategoriesPanel } from "@/features/store-categories/components/store-categories-panel";`
replace the store-categories branch:
```tsx
{tab === "store-categories" && (
	<CategoryCrudPanel
		config={storeCategoriesConfig}
		createOpen={createOpen}
		onCreateOpenChange={setCreateOpen}
	/>
)}
```

- [ ] **Step 3: Delete the old panel**

```bash
git rm apps/admin/src/features/store-categories/components/store-categories-panel.tsx
```

- [ ] **Step 4: Typecheck**

Run: `bun run --filter @bibs/admin typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`. If `list` errors on the query object: the API list route is the unqualified `api()["store-categories"].get` and accepts `{ page, limit, search?, sortBy, sortOrder }` — match exactly (no extra keys).

- [ ] **Step 5: Build**

Run: `bun run --filter @bibs/admin build; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 6: Browser smoke (store-categories tab)**

Start admin dev (`bun run dev:admin`, port 3003), log in, open `/configurations?tab=store-categories`. Verify: list loads + paginates; search filters (debounced, resets to page 1); sort toggles on Nome/Data Creazione; create (Nuova → Crea) adds a row + toast + parent count updates; edit (Pencil → Salva) updates; delete (Trash → Elimina) removes; "Importa CSV" opens the dialog. Confirm no console errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/features/store-categories/store-categories.config.tsx apps/admin/src/routes/_authenticated/configurations.tsx
git commit -m "refactor(admin): store-categories on CategoryCrudPanel"
```

---

## Task 3: Migrate product-macro-categories (vat column + Select form, 3-key invalidate, no CSV)

**Files:**
- Create: `apps/admin/src/features/product-macro-categories/product-macro-categories.config.tsx`
- Modify: `apps/admin/src/routes/_authenticated/configurations.tsx`
- Delete: `apps/admin/src/features/product-macro-categories/components/product-macro-categories-panel.tsx`

**Interfaces:**
- Consumes: `CategoryCrudConfig`, `ColumnDef`; `ProductMacroCategoryForm` + `ProductMacroCategoryFormData` (unchanged); `api`.
- Produces: `productMacroCategoriesConfig`.

- [ ] **Step 1: Confirm exact delete-warning copy + entity vat type**

Read `…/product-macro-categories-panel.tsx` lines ~440-470 for the precise delete-dialog body (the "sotto-categorie collegate" warning) and the `suggestedVatRate` field type used in the row cell, so Step 2 matches verbatim.

- [ ] **Step 2: Create the config**

Create `apps/admin/src/features/product-macro-categories/product-macro-categories.config.tsx`:

```tsx
import type { ColumnDef } from "@tanstack/react-table";
import { LayersIcon } from "lucide-react";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
import { ProductMacroCategoryForm } from "@/features/product-macro-categories/components/product-macro-category-form";
import type { ProductMacroCategoryFormData } from "@/features/product-macro-categories/schemas/product-macro-category";
import { api } from "@/lib/api";

interface ProductMacroCategory {
	id: string;
	name: string;
	suggestedVatRate: string;
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
	editDefaults: (e) => ({
		name: e.name,
		suggestedVatRate:
			e.suggestedVatRate as ProductMacroCategoryFormData["suggestedVatRate"],
	}),

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
		deleteDescription: (name) => (
			<>
				Sei sicuro di voler eliminare la macro categoria "{name}"? Questa azione
				non può essere annullata.
				<br />
				<br />
				L'eliminazione fallirà se ci sono ancora sotto-categorie collegate.
			</>
		),
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
```

(Adjust the delete-warning text and `suggestedVatRate` typing per Step 1 findings.)

- [ ] **Step 3: Wire the route + delete old panel**

In `configurations.tsx`: add `import { productMacroCategoriesConfig } from "@/features/product-macro-categories/product-macro-categories.config";`, remove the `ProductMacroCategoriesPanel` import, replace its branch with `<CategoryCrudPanel config={productMacroCategoriesConfig} createOpen={createOpen} onCreateOpenChange={setCreateOpen} />`. Then:
```bash
git rm apps/admin/src/features/product-macro-categories/components/product-macro-categories-panel.tsx
```

- [ ] **Step 4: Typecheck**

Run: `bun run --filter @bibs/admin typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`. If `suggestedVatRate` errors in `editDefaults` or `create`, reconcile the entity field type with the form enum (`"22"|"10"|"5"|"4"|"0"`) — cast as shown.

- [ ] **Step 5: Browser smoke (product-macro-categories tab)**

Verify the same CRUD flows + the **IVA suggerita** column renders `NN%`, the create/edit form's VAT `Select` works (no clobber when switching edit targets), and there is **no** "Importa CSV" button. Confirm deleting a macro with linked sub-categories surfaces the server error toast.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/features/product-macro-categories/product-macro-categories.config.tsx apps/admin/src/routes/_authenticated/configurations.tsx
git commit -m "refactor(admin): product-macro-categories on CategoryCrudPanel"
```

---

## Task 4: Migrate product-categories (macro filter + relation column + macros-connected form + CSV)

**Files:**
- Create: `apps/admin/src/features/product-categories/product-categories.config.tsx`
- Modify: `apps/admin/src/routes/_authenticated/configurations.tsx`
- Delete: `apps/admin/src/features/product-categories/components/product-categories-panel.tsx`

**Interfaces:**
- Consumes: `CategoryCrudConfig`, `CrudFormProps`, `ColumnDef`, `useQuery`; `ProductCategoryForm` + `ProductCategoryFormData`; `NativeSelect`/`NativeSelectOption`; `CsvImportResult`; `api`.
- Produces: `productCategoriesConfig`.

- [ ] **Step 1: Confirm CSV copy + entity relation shape**

Read `…/product-categories-panel.tsx` lines ~256-259 (CSV `formatHint`/`description`) and the `ProductCategory` interface (relation `macroCategory: { id; name }`, `macroCategoryId`), to match verbatim in Step 2.

- [ ] **Step 2: Create the config (with deduped macros query for both filter and form)**

Create `apps/admin/src/features/product-categories/product-categories.config.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { TagsIcon } from "lucide-react";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import type { CsvImportResult } from "@/features/csv-import/components/csv-import-dialog";
import type {
	CategoryCrudConfig,
	CrudFormProps,
} from "@/features/crud/category-crud-panel";
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

// Shared macros query — TanStack dedupes by key, so the toolbar filter and the
// form fetch it exactly once (one network request), matching the old panel.
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
	});
	return { macros: (data?.data ?? []) as MacroCategory[], isLoading };
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
			description: "Inserisci macro categoria e nome della nuova sotto-categoria.",
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
```

(Match the CSV `description`/`formatHint` to the verbatim copy found in Step 1.)

- [ ] **Step 3: Wire the route + delete old panel**

In `configurations.tsx`: add `import { productCategoriesConfig } from "@/features/product-categories/product-categories.config";`, remove the `ProductCategoriesPanel` import, replace its branch with `<CategoryCrudPanel config={productCategoriesConfig} createOpen={createOpen} onCreateOpenChange={setCreateOpen} />`. Then:
```bash
git rm apps/admin/src/features/product-categories/components/product-categories-panel.tsx
```

- [ ] **Step 4: Typecheck**

Run: `bun run --filter @bibs/admin typecheck; echo "EXIT=$?"`
Expected: `EXIT=0`. Common fix points: the `q.macroCategoryId as string` cast (index-signature widening); `ProductCategoryForm` prop names (`macros`, `macrosLoading`).

- [ ] **Step 5: Build**

Run: `bun run --filter @bibs/admin build; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 6: Browser smoke (product-categories tab)**

Verify CRUD + the **Macro Categoria** relation column shows the parent name (or "—"); the **macro filter** dropdown filters the list + resets to page 1; the create/edit form's macro `NativeSelect` is populated; **one** network request for `product-macro-categories?…all` is shared by filter + form (DevTools Network); "Importa CSV" works. Cross-check: creating/editing in this tab updates the parent count badge.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/features/product-categories/product-categories.config.tsx apps/admin/src/routes/_authenticated/configurations.tsx
git commit -m "refactor(admin): product-categories on CategoryCrudPanel"
```

---

## Task 5: Full verification + line-count check + open PR

**Files:** none (verification only).

- [ ] **Step 1: Full admin typecheck**

Run: `bun run --filter @bibs/admin typecheck; echo "EXIT=$?"` → `EXIT=0`.

- [ ] **Step 2: Lint**

Run: `bunx biome check apps/admin/src; echo "EXIT=$?"` → `EXIT=0` (the Edit/Write hook auto-fixes; this confirms).

- [ ] **Step 3: Build**

Run: `bun run --filter @bibs/admin build; echo "EXIT=$?"` → `EXIT=0`. Confirm `git status` shows `routeTree.gen.ts` unchanged (no new routes).

- [ ] **Step 4: Confirm holidays untouched + regression sweep**

Open `/configurations?tab=holidays` — unchanged behavior (preview block, status toggle, inline rename). Re-smoke each of the other three tabs once more for cross-tab `createOpen` reset (switching tabs closes the create dialog).

- [ ] **Step 5: Net line-count check**

Run:
```bash
git diff --stat main...refactor/category-crud-panel -- apps/admin/src
```
Expected: the three deleted panels (~1505 L) minus the new generic (~330) + 3 configs (~300) ≈ **net −850/−900** in `apps/admin/src`.

- [ ] **Step 6: Push + open PR**

```bash
git push -u origin refactor/category-crud-panel
gh pr create --title "refactor(admin): generic CategoryCrudPanel (#NN)" \
  --body "Collapses the 3 near-identical admin category CRUD panels into one config-driven CategoryCrudPanel. Holidays untouched. Net ~-880 lines. Spec: docs/superpowers/specs/2026-06-24-category-crud-panel-design.md"
```
(Replace `#NN` only if a tracking issue exists; otherwise let the squash-merge UI append the PR number.)

---

## Self-Review

**Spec coverage:**
- Config-object shape → Task 1 (`CategoryCrudConfig`). ✓
- Eden closures / asymmetric paths / divergent param keys → Tasks 2-4 closures. ✓
- `"use no memo"` → Task 1 Step 1. ✓
- Keyed edit form (RHF reset footgun) → Task 1 (`<div key={selected.id}>`). ✓
- Per-config cross-invalidation (macro = 3 keys) → Task 3 `extraInvalidate`. ✓
- Irregular IT pluralization → `labels.total(n)` in each config. ✓
- `useDebouncedValue` (native finding) → Task 1. ✓
- Central Eden unwrap → Task 1 `unwrap`. ✓
- Macro filter + relation column + deduped macros for filter+form → Task 4. ✓
- CSV optional slot (store+product, not macro) → Tasks 2/4 have it, Task 3 omits. ✓
- Column-width normalization → Task 1 columns drop `w-[..]` (deliberate). ✓
- Holidays out of scope → never touched; verified Task 5 Step 4. ✓
- Verify via typecheck+build+smoke → every task gate. ✓

**Placeholder scan:** Tasks 3/4 Step 1 are real "read exact copy" actions (verbatim strings live in the source); all code blocks are complete. No TBD/TODO.

**Type consistency:** `CategoryCrudConfig`/`CrudFormProps`/`CrudListQuery`/`CategoryEntity` defined in Task 1 are consumed with identical names in Tasks 2-4. `editDefaults`, `renderForm`, `extraInvalidate`, `toolbarFilter`, `csvImport`, `labels.*` match the Task 1 interface exactly. Route prop names (`config`, `createOpen`, `onCreateOpenChange`) consistent across Tasks 2-4.
