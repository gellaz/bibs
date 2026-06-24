# Generic `CategoryCrudPanel` — design

**Date:** 2026-06-24
**Status:** approved, pending implementation plan
**Branch:** `refactor/category-crud-panel`

## Problem

The admin "Configurazioni" page hosts four CRUD panels. Three of them are
~95% copy-paste of each other:

| Panel | Lines | File |
|---|---|---|
| store-categories | 477 | `apps/admin/src/features/store-categories/components/store-categories-panel.tsx` |
| product-macro-categories | 477 | `apps/admin/src/features/product-macro-categories/components/product-macro-categories-panel.tsx` |
| product-categories | 551 | `apps/admin/src/features/product-categories/components/product-categories-panel.tsx` |

Each re-implements the identical skeleton: page/limit/search state, a
hand-rolled `useRef`+`setTimeout` debounce, a sort toggle, the list `useQuery`,
three `useMutation`s (create/update/delete) with `invalidateAll`, the
name/createdAt/actions columns, the toolbar (search + optional CSV button),
pagination, and three dialogs (create/edit/delete). The per-call Eden
`if (response.error) throw` block is repeated ~5× per panel.

The fourth panel, **holidays** (459 L), diverges structurally (no
pagination/search/sort, a discriminated-union create form, an inline-rename
edit, a status toggle, a year-preview block) and is **out of scope** — it
stays exactly as-is.

This was the largest single finding of the 2026-06-24 ponytail audit
(~-895 lines).

## Goal

Collapse the three near-identical panels into one generic
`CategoryCrudPanel<TEntity, TForm>` driven by a thin per-entity config object,
**preserving behavior** (one deliberate visual normalization, called out
below). Net ≈ 1505 → ≈ 610 lines.

## Why a config object (not a hook or compound components)

Decided with the user. A single `<CategoryCrudPanel config={…} />` keeps the
per-entity surface to one thin config file each — matching the "thin config"
goal with the least API surface. A headless hook (`useCrudResource`) adds a
second moving part per call site for no benefit at three call sites; compound
components push assembly back into each panel and defeat the dedup.

## Key constraints discovered

1. **Eden is statically typed per-path; route-param names diverge.** Writes use
   `api().admin["store-categories"]({ categoryId })` /
   `…["product-categories"]({ productCategoryId })` /
   `…["product-macro-categories"]({ macroCategoryId })`. You cannot pass a path
   string or a captured node into a generic and call it uniformly. **The config
   must expose data access as closures** (`list`/`create`/`update`/`remove`),
   each closing over the concrete `api.x.y` call at its own site.
2. **Read vs write paths are asymmetric.** Lists read the unqualified route
   (`api()["store-categories"].get(...)`); writes go through `api().admin[...]`.
   Closures handle this naturally.
3. **React Compiler.** Every panel (and `DataTable`/`useDataTable`) carries
   `"use no memo"` as its first statement because it owns/consumes TanStack
   Table state. The generic **must keep `"use no memo"`**.
4. **RHF `reset(defaultValues)` footgun.** `store-category-form` and
   `product-category-form` carry a `useEffect(() => reset(defaultValues))` that
   the repo has flagged as a latent shadcn-`Select` clobber;
   `product-macro-category-form` deliberately dropped it and relies on Radix
   Dialog remounting. The generic **keys the edit form by `selected.id`** so
   each edit target remounts fresh — the three forms stay untouched and safe.
5. **Cross-entity invalidation varies.** macro invalidates
   `product-categories` (its sub-categories) **and**
   `admin-configurations-counts`; store/product invalidate only
   `admin-configurations-counts`. Per-config `extraInvalidate`.
6. **Irregular Italian pluralization.** Totals read `categori{a|e}` /
   `categori{a|e} prodotto` / `macro categori{a|e}` — not a `+s` rule. The
   config supplies `total(n)` so each entity prints its exact string.

## The config interface

```ts
type CrudListResult<T> = { data: T[]; pagination: { total: number } };
type EdenErr = { value?: { message?: string } | string } | null;
type EdenRes<T> = { data: T | null; error: EdenErr };

interface CrudFormProps<TForm> {
  defaultValues?: TForm;
  onSubmit: (data: TForm) => void;
  onCancel: () => void;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
}

interface CategoryCrudConfig<
  TEntity extends { id: string; name: string; createdAt: Date | string },
  TForm,
> {
  queryKeyBase: string;                              // "store-categories"
  storageKey: string;                                // "admin.store-categories.columns"
  extraInvalidate?: readonly (readonly string[])[];  // [["admin-configurations-counts"]]

  // data — closures return the RAW eden promise; the generic unwraps once.
  list:   (q: CrudListQuery) => Promise<EdenRes<CrudListResult<TEntity>>>;
  create: (form: TForm)            => Promise<EdenRes<unknown>>;
  update: (id: string, form: TForm) => Promise<EdenRes<unknown>>;
  remove: (id: string)             => Promise<EdenRes<unknown>>;

  extraColumns?: ColumnDef<TEntity>[];   // inserted between name & createdAt
  emptyIcon: ReactNode;                  // <StoreIcon/> etc.

  renderForm: (p: CrudFormProps<TForm>) => ReactNode; // store: (p)=><StoreCategoryForm {...p}/>
  editDefaults: (e: TEntity) => TForm;                // (e)=>({ name: e.name })

  // optional slots
  toolbarFilter?: (ctx: {
    values: Record<string, string>;
    set: (key: string, value: string) => void;
  }) => ReactNode;                       // product-categories only (macro filter)
  csvImport?: {
    onImport: (file: File) => Promise<CsvImportResult>;
    title: string;
    description: string;
    formatHint: string;
  };                                     // store + product

  labels: {
    searchPlaceholder: string;
    empty: { title: string; subtitle: string };
    total: (n: number) => string;
    createDialog: { title: string; description: string };
    editDialog: { title: string; description: string };
    deleteDescription: (name: string) => ReactNode;  // macro appends a warning
    toasts: { createOk: string; updateOk: string; deleteOk: string };
    rowAria: { edit: string; delete: string };
  };
}

interface CrudListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: "name" | "createdAt";
  sortOrder: "asc" | "desc";
  [filterKey: string]: string | number | undefined; // toolbar filter values
}
```

### What the generic owns (identical across all three)

- State: `page`, `limit`, `search` + **`useDebouncedValue`** (replaces the
  hand-rolled ref/timeout; same 300 ms, same page-reset), `sortBy`, `sortOrder`,
  `editOpen`, `deleteOpen`, `importOpen`, `selected`, and a
  `filterValues: Record<string,string>` bag.
- `handleSort` (toggle asc/desc, reset page); `setFilterValue` (update bag,
  reset page); page-size change (reset page).
- The list `useQuery`, keyed `[queryKeyBase, page, limit, debouncedSearch,
  sortBy, sortOrder, filterValues]`, building the query object (omitting empty
  `search`, spreading truthy `filterValues`) and calling `config.list`.
- `create`/`update`/`delete` `useMutation`s + `invalidateAll` (invalidates
  `[queryKeyBase]` and every `extraInvalidate` key).
- **Central Eden unwrap:** one helper `unwrap(res, fallback)` used by every
  query/mutation, replacing the per-call `if (error) throw` blocks.
- Columns: builds **name** (sortable) + `...extraColumns` + **createdAt**
  (sortable, it-IT long date) + **actions** (pencil/trash with
  `labels.rowAria`, plus `TableColumnsToggle` in the actions header).
- Toolbar: search input + `toolbarFilter?` slot + CSV button (when
  `csvImport`); `DataTable`; pagination (`PageSizeSelector` + `DataPagination`
  + `labels.total`); the three dialogs + `CsvImportDialog` (when `csvImport`).
- `"use no memo"` as the first statement.

### How the two hard cases resolve

- **product-categories macro filter + form options** both call
  `useQuery(["product-macro-categories", "all"])`. TanStack Query **dedupes by
  key → a single network request**, identical to today. The generic stays
  ignorant of "macros": it only maintains `filterValues`, spreads truthy values
  into the list query + queryKey, and resets page on change. The dropdown
  (`toolbarFilter`) and the macros-connected form wrapper both live in the
  product config.
- **edit form remount:** the generic renders `config.renderForm(...)` inside the
  edit dialog keyed by `selected?.id`, so switching edit targets remounts the
  form — no reliance on the flagged `reset` effect.

## Files

**New**
- `apps/admin/src/features/crud/category-crud-panel.tsx` — the generic
  component + exported `CategoryCrudConfig` type (~330 L).
- `apps/admin/src/features/store-categories/store-categories.config.tsx` (~70 L)
- `apps/admin/src/features/product-macro-categories/product-macro-categories.config.tsx` (~90 L)
- `apps/admin/src/features/product-categories/product-categories.config.tsx` (~120 L; includes the macro filter render + the macros-connected form wrapper)

**Deleted**
- the three `*-panel.tsx` (1505 L total)

**Unchanged**
- the three `*-form.tsx`, the three `schemas/*.ts`, `CsvImportDialog`, and the
  entire **holidays** feature.

**Edited**
- `apps/admin/src/routes/_authenticated/configurations.tsx` — the three
  category branches become
  `<CategoryCrudPanel config={…} createOpen={createOpen} onCreateOpenChange={setCreateOpen} />`.
  The holidays branch is untouched.

## Behavior preservation & deliberate changes

Preserved exactly: every IT string, the create-dialog open state owned by the
parent route, edit/delete owned internally, sort fields (name/createdAt only),
the relation/vat columns, CSV import flows, cross-entity invalidation, the
parent counts badge refresh, the macro-filter query param, prefix-match
invalidation of the macros options.

Three deliberate micro-changes:
1. **Debounce** → `useDebouncedValue` (folds in the audit's `native:` finding).
2. **Eden unwrap** centralized with one Italian fallback string. The current
   per-entity English fallbacks (`"Failed to fetch store categories"`) are shown
   only when the server returns no message — near-never, and already
   inconsistent — so normalizing them is acceptable.
3. **Column widths normalized** to one scheme (currently 40/40/20 vs
   30/30/25/15 — arbitrary). If pixel preservation is wanted, add per-config
   width overrides; not planned by default.

## Testing & verification

Admin has **no FE test harness** today. Verification plan:
- `bun run --filter @bibs/admin typecheck` (per-workspace; catches Eden treaty
  type regressions).
- `bun run build` for admin (regenerates/validates `routeTree.gen.ts`).
- Browser smoke on all three tabs: create / edit / delete / search (debounced) /
  sort toggle / page-size, plus product-categories' macro filter and the
  store+product CSV import.

No RTL test is planned (would mean standing up a test harness in admin solely
for this). If desired, a single smoke test of the generic panel can be added
once the harness exists.

## Out of scope

- The holidays panel.
- Other audit findings (cross-app dedup, dead deps, etc.).
- Any change to the three form components or their zod schemas.
