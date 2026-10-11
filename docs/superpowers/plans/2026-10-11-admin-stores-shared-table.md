# Negozi in admin e kit liste condiviso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le liste di admin e seller usano gli stessi pezzi condivisi (`PageHeader`, `SearchInput`, `DataTableFooter`) con lo stile seller, e Admin → Negozi mostra tutti i negozi della piattaforma.

**Architecture:** Tre componenti piccoli in `packages/ui/src/custom/` sostituiscono il markup copiato attorno a `DataTable` (già condiviso). PR 1 li introduce e migra admin e seller; PR 2 aggiunge `GET /admin/stores` + `GET /admin/stores/counts` e la pagina admin costruita sul kit.

**Tech Stack:** React 19 + React Compiler, TanStack Start/Router/Query/Table v9, Tailwind 4, Paraglide, Vitest + Testing Library (FE), Elysia + Drizzle + TypeBox, bun test + testcontainer (API).

**Spec:** [`docs/superpowers/specs/2026-10-11-admin-stores-shared-table-design.md`](../specs/2026-10-11-admin-stores-shared-table-design.md)

## Global Constraints

- Mai commit su `main`: PR 1 sul branch `refactor/shared-list-kit` (già creato, contiene la spec); PR 2 su `feat/admin-stores`.
- Conventional Commits; scope dalla whitelist (`ui`, `admin`, `seller`, `api`, `docs`). Ogni commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Niente `--no-verify`; niente modifiche a mano a `bun.lock` (solo `bun install`).
- Debounce della ricerca: **300 ms**.
- Testi utente solo in `messages/{it,en}.json` (Paraglide), mai hard-coded. Componenti `@bibs/ui` ricevono i testi via props.
- Toast solo da `@bibs/ui/components/sonner`, mai da `sonner`.
- Celle: padding di default `px-3` (niente override `pl-*`/`pr-*` su prima/ultima colonna).
- Scorrimento invariato: scorre la finestra (verificato). Non aggiungere layout a scroll interno.
- API: schema TypeBox in `apps/api/src/lib/schemas/` con `description` in italiano, `okPageRes`/`okRes`, `withErrors`, `detail` completo.
- Gate di chiusura per ogni PR: `bun run typecheck`, `bun run lint`, `bun run test` (suite completa, non `bun test` nudo), browser via Chrome DevTools MCP, poi smoke manuale di Marco prima di aprire la PR.

## Review Focus

- **Back/forward dopo una ricerca** (`?q=abc` → Indietro → `?q=` vuoto): il campo si svuota e la query vecchia **non** viene rispinta nell'URL. Il codice attuale di users/products la rispinge. → test in Task 1.
- **`page` oltre l'ultima nell'URL** (`?page=9` con 45 righe da 20): il piede mostra `41–45 di 45` e la paginazione riporta a pagina 3 con `replace`. → test in Task 2.
- **Scrivere e cancellare dentro il debounce**: nessuna ricerca parte. → test in Task 1.
- **Negozio di un venditore senza organization o senza categoria**: compare in lista con «—», non sparisce (join esterne). → test in Task 8.
- **Ricerca con `%` o `_`**: match letterale, non jolly. → test in Task 8.

---

# PR 1 — Kit condiviso (`refactor/shared-list-kit`)

### Task 1: `SearchInput` in `packages/ui`

**Files:**
- Modify: `packages/ui/package.json` (devDependencies)
- Create: `packages/ui/src/custom/search-input.tsx`
- Test: `packages/ui/src/custom/search-input.test.tsx`

**Interfaces:**
- Produces: `SearchInput({ value: string; onValueChange: (value: string) => void; clearLabel: string; placeholder?: string; "aria-label"?: string; className?: string })` da `@bibs/ui/custom/search-input`. `className` va sull'`InputGroup` (larghezza).

- [ ] **Step 1: Aggiungi le dipendenze di test DOM a `packages/ui`**

In `packages/ui/package.json`, `devDependencies` (ordine alfabetico), aggiungi:

```json
		"@testing-library/dom": "catalog:",
		"@testing-library/react": "catalog:",
		"jsdom": "catalog:",
```

Run: `bun install`
Expected: termina senza errori; `bun.lock` aggiornato da bun.

- [ ] **Step 2: Scrivi il test che fallisce**

`packages/ui/src/custom/search-input.test.tsx`:

```tsx
// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchInput } from "./search-input";

beforeEach(() => {
	vi.useFakeTimers();
});

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function setup(initial = "") {
	const onValueChange = vi.fn();
	const view = (value: string) => (
		<SearchInput
			value={value}
			onValueChange={onValueChange}
			aria-label="Cerca"
			clearLabel="Cancella ricerca"
		/>
	);
	const { rerender } = render(view(initial));
	const input = screen.getByRole("textbox", { name: "Cerca" }) as HTMLInputElement;
	return { onValueChange, input, setValue: (v: string) => rerender(view(v)) };
}

describe("SearchInput", () => {
	it("conferma una volta sola, dopo 300 ms di quiete", () => {
		const { onValueChange, input } = setup();
		fireEvent.change(input, { target: { value: "a" } });
		fireEvent.change(input, { target: { value: "ab" } });
		act(() => vi.advanceTimersByTime(299));
		expect(onValueChange).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(onValueChange).toHaveBeenCalledTimes(1);
		expect(onValueChange).toHaveBeenCalledWith("ab");
	});

	it("un valore che cambia da fuori (back/forward) vince su un tasto in attesa", () => {
		const { onValueChange, input, setValue } = setup("abc");
		fireEvent.change(input, { target: { value: "abcd" } });
		setValue("");
		act(() => vi.advanceTimersByTime(1000));
		expect(onValueChange).not.toHaveBeenCalled();
		expect(input.value).toBe("");
	});

	it("scrivere e cancellare dentro il debounce non conferma nulla", () => {
		const { onValueChange, input } = setup();
		fireEvent.change(input, { target: { value: "ab" } });
		fireEvent.change(input, { target: { value: "" } });
		act(() => vi.advanceTimersByTime(1000));
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it("«cancella» svuota e conferma subito", () => {
		const { onValueChange, input } = setup("abc");
		fireEvent.click(screen.getByRole("button", { name: "Cancella ricerca" }));
		expect(onValueChange).toHaveBeenCalledTimes(1);
		expect(onValueChange).toHaveBeenCalledWith("");
		expect(input.value).toBe("");
	});

	it("senza testo non mostra «cancella»", () => {
		setup();
		expect(screen.queryByRole("button", { name: "Cancella ricerca" })).toBeNull();
	});
});
```

- [ ] **Step 3: Verifica che fallisca**

Run: `cd packages/ui && bunx vitest run src/custom/search-input.test.tsx`
Expected: FAIL — `Failed to resolve import "./search-input"`.

- [ ] **Step 4: Implementa**

`packages/ui/src/custom/search-input.tsx`:

```tsx
"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "~/components/input-group";

const DEBOUNCE_MS = 300;

interface SearchInputProps {
	/** Valore confermato (URL o state): il campo lo segue quando cambia da fuori. */
	value: string;
	/** Chiamata dopo 300 ms di quiete, solo se il testo differisce da `value`. */
	onValueChange: (value: string) => void;
	clearLabel: string;
	placeholder?: string;
	"aria-label"?: string;
	/** Classe dell'`InputGroup` (tipicamente la larghezza). */
	className?: string;
}

/**
 * Campo di ricerca delle liste: icona, «cancella», debounce. Nessuna
 * dipendenza dal router: il chiamante decide dove vive il valore confermato.
 */
export function SearchInput({
	value,
	onValueChange,
	clearLabel,
	placeholder,
	"aria-label": ariaLabel,
	className,
}: SearchInputProps) {
	const [text, setText] = useState(value);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Back/forward o un reset da fuori vincono su un tasto ancora in attesa:
	// altrimenti il timer rispingerebbe la ricerca vecchia nell'URL.
	useEffect(() => {
		clearTimeout(timer.current);
		setText(value);
	}, [value]);

	useEffect(() => () => clearTimeout(timer.current), []);

	const change = (next: string) => {
		setText(next);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			if (next !== value) onValueChange(next);
		}, DEBOUNCE_MS);
	};

	const clear = () => {
		setText("");
		clearTimeout(timer.current);
		if (value !== "") onValueChange("");
	};

	return (
		<InputGroup className={className}>
			<InputGroupAddon align="inline-start">
				<SearchIcon />
			</InputGroupAddon>
			<InputGroupInput
				value={text}
				onChange={(e) => change(e.target.value)}
				placeholder={placeholder}
				aria-label={ariaLabel}
			/>
			{text.length > 0 && (
				<InputGroupAddon align="inline-end">
					<InputGroupButton
						size="icon-xs"
						onClick={clear}
						aria-label={clearLabel}
					>
						<XIcon />
					</InputGroupButton>
				</InputGroupAddon>
			)}
		</InputGroup>
	);
}
```

- [ ] **Step 5: Verifica che passi**

Run: `cd packages/ui && bunx vitest run src/custom/search-input.test.tsx`
Expected: PASS, 5 test.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/package.json bun.lock packages/ui/src/custom/search-input.tsx packages/ui/src/custom/search-input.test.tsx
git commit -m "feat(ui): SearchInput con debounce condiviso dalle liste

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `DataTableFooter`, `PageHeader` e le label nelle app

**Files:**
- Create: `packages/ui/src/custom/data-table-footer.tsx`
- Create: `packages/ui/src/custom/page-header.tsx`
- Test: `packages/ui/src/custom/data-table-footer.test.tsx`
- Modify: `apps/admin/src/lib/ui-labels.ts`, `apps/seller/src/lib/ui-labels.ts`

**Interfaces:**
- Consumes: `DataPagination`, `DataPaginationLabels` (`~/custom/data-pagination`), `PageSizeSelector` (`~/custom/page-size-selector`), `clampPage` (`~/lib/pagination-search`).
- Produces:
  - `DataTableFooter({ page, pageSize, total, onPageChange: (page: number, options?: { replace?: boolean }) => void, onPageSizeChange: (pageSize: number) => void, rangeLabel: (range: { start: number; end: number; total: number }) => string, labels: DataTableFooterLabels })` e `type DataTableFooterLabels = { rowsPerPage: string; pagination: DataPaginationLabels }` da `@bibs/ui/custom/data-table-footer`.
  - `PageHeader({ title: string; description?: string; children?: ReactNode })` da `@bibs/ui/custom/page-header`.
  - `dataTableFooterLabels(): DataTableFooterLabels` in `@/lib/ui-labels` di admin e seller.

- [ ] **Step 1: Scrivi il test che fallisce**

`packages/ui/src/custom/data-table-footer.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTableFooter } from "./data-table-footer";

const labels = {
	rowsPerPage: "Righe per pagina",
	pagination: {
		previous: "Pagina precedente",
		next: "Pagina successiva",
		page: (p: number) => `Pagina ${p}`,
	},
};

function html(page: number, total: number) {
	return renderToStaticMarkup(
		<DataTableFooter
			page={page}
			pageSize={20}
			total={total}
			onPageChange={() => {}}
			onPageSizeChange={() => {}}
			rangeLabel={(r) => `${r.start}–${r.end} di ${r.total}`}
			labels={labels}
		/>,
	);
}

describe("DataTableFooter", () => {
	it("range della pagina corrente", () => {
		expect(html(2, 45)).toContain("21–40 di 45");
	});

	it("ultima pagina parziale", () => {
		expect(html(3, 45)).toContain("41–45 di 45");
	});

	it("pagina oltre la fine: range della pagina riportata dentro", () => {
		expect(html(9, 45)).toContain("41–45 di 45");
	});

	it("nessun risultato a pagina 1: niente piede", () => {
		expect(html(1, 0)).toBe("");
	});

	it("nessun risultato oltre pagina 1: il piede resta per riportare la pagina dentro", () => {
		expect(html(4, 0)).not.toBe("");
	});

	it("passa le label a selettore e paginazione", () => {
		const out = html(1, 45);
		expect(out).toContain("Righe per pagina");
		expect(out).toContain("Pagina successiva");
	});
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `cd packages/ui && bunx vitest run src/custom/data-table-footer.test.tsx`
Expected: FAIL — `Failed to resolve import "./data-table-footer"`.

- [ ] **Step 3: Implementa `DataTableFooter`**

`packages/ui/src/custom/data-table-footer.tsx`:

```tsx
import {
	DataPagination,
	type DataPaginationLabels,
} from "~/custom/data-pagination";
import { PageSizeSelector } from "~/custom/page-size-selector";
import { clampPage } from "~/lib/pagination-search";

export interface DataTableFooterLabels {
	rowsPerPage: string;
	pagination: DataPaginationLabels;
}

interface DataTableFooterProps {
	page: number;
	pageSize: number;
	total: number;
	/** Stessa firma di `DataPagination`: `replace` quando riporta dentro una pagina fuori range. */
	onPageChange: (page: number, options?: { replace?: boolean }) => void;
	onPageSizeChange: (pageSize: number) => void;
	/** Testo del range per entità, es. `21–40 di 45 ordini`. */
	rangeLabel: (range: { start: number; end: number; total: number }) => string;
	labels: DataTableFooterLabels;
}

/** Piede delle liste paginate: range, righe per pagina, paginazione. */
export function DataTableFooter({
	page,
	pageSize,
	total,
	onPageChange,
	onPageSizeChange,
	rangeLabel,
	labels,
}: DataTableFooterProps) {
	// Con `page` oltre l'ultima resta visibile: DataPagination la riporta dentro.
	if (total === 0 && page <= 1) return null;

	const totalPages = Math.ceil(total / pageSize);
	const current = clampPage(page, totalPages);
	const start = Math.min((current - 1) * pageSize + 1, total);
	const end = Math.min(current * pageSize, total);

	return (
		<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
			<p className="text-muted-foreground text-sm tabular-nums">
				{rangeLabel({ start, end, total })}
			</p>
			<div className="flex items-center gap-4">
				<PageSizeSelector
					label={labels.rowsPerPage}
					pageSize={pageSize}
					onPageSizeChange={onPageSizeChange}
				/>
				<DataPagination
					labels={labels.pagination}
					page={page}
					totalPages={totalPages}
					onPageChange={onPageChange}
				/>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Verifica che passi**

Run: `cd packages/ui && bunx vitest run src/custom/data-table-footer.test.tsx`
Expected: PASS, 6 test.

- [ ] **Step 5: Crea `PageHeader`**

`packages/ui/src/custom/page-header.tsx` (classi identiche all'header seller attuale: nessun cambio di DOM sulle liste seller):

```tsx
import type { ReactNode } from "react";

/** Titolo di pagina del back-office; `children` sono le azioni a destra. */
export function PageHeader({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex shrink-0 items-center justify-between">
			<div>
				<h1 className="font-display text-2xl font-semibold tracking-tight">
					{title}
				</h1>
				{description && (
					<p className="text-muted-foreground text-sm">{description}</p>
				)}
			</div>
			{children}
		</div>
	);
}
```

- [ ] **Step 6: Aggiungi `dataTableFooterLabels()` alle due app**

In `apps/admin/src/lib/ui-labels.ts` **e** `apps/seller/src/lib/ui-labels.ts`: aggiungi l'import del tipo e la funzione subito dopo `dataPaginationLabels()`.

```ts
import type { DataTableFooterLabels } from "@bibs/ui/custom/data-table-footer";
```

```ts
export function dataTableFooterLabels(): DataTableFooterLabels {
	return {
		rowsPerPage: m.common_rows_per_page(),
		pagination: dataPaginationLabels(),
	};
}
```

- [ ] **Step 7: Typecheck e commit**

Run: `bun run typecheck`
Expected: exit 0.

```bash
git add packages/ui/src/custom/data-table-footer.tsx packages/ui/src/custom/data-table-footer.test.tsx packages/ui/src/custom/page-header.tsx apps/admin/src/lib/ui-labels.ts apps/seller/src/lib/ui-labels.ts
git commit -m "feat(ui): DataTableFooter e PageHeader condivisi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Seller sulle quattro liste — refactor puro

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/orders/index.tsx`
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx`
- Modify: `apps/seller/src/routes/_authenticated/promotions/index.tsx`
- Modify: `apps/seller/src/routes/_authenticated/team/index.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `SearchInput`, `DataTableFooter` (Task 1–2), `dataTableFooterLabels` da `@/lib/ui-labels`.

- [ ] **Step 1: Fotografa il DOM prima di toccare il codice**

Dev seller attivo su `:3002`, login `seller1@test.com` / `password123` in un contesto isolato di Chrome DevTools MCP. Per ciascuna URL:
`/orders`, `/products?statusFilter=all`, `/products?statusFilter=all&q=a`, `/promotions`, `/team`, salva l'HTML con `evaluate_script`:

```js
() => {
	const main = document.querySelector('[data-slot="sidebar-inset"]').cloneNode(true);
	for (const el of main.querySelectorAll("[data-tsd-source]")) el.removeAttribute("data-tsd-source");
	return main.outerHTML;
}
```

con `filePath` = `<scratchpad>/dom-before-<pagina>.html`.

- [ ] **Step 2: `orders` — header e piede**

Sostituisci il blocco titolo:

```tsx
			<div className="shrink-0">
				<h1 className="font-display font-semibold text-2xl tracking-tight">
					{m.orders_page_title()}
				</h1>
				<p className="text-muted-foreground text-sm">
					{m.orders_page_subtitle()}
				</p>
			</div>
```

con:

```tsx
			<PageHeader
				title={m.orders_page_title()}
				description={m.orders_page_subtitle()}
			/>
```

Sostituisci l'intero blocco `{data?.pagination && data.pagination.total > 0 && (() => { … })()}` con:

```tsx
			<DataTableFooter
				page={page}
				pageSize={limit}
				total={data?.pagination.total ?? 0}
				rangeLabel={(r) =>
					(r.total === 1
						? m.orders_pagination_range_one
						: m.orders_pagination_range)(r)
				}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) =>
					void navigate({
						search: (prev) => ({ ...prev, limit: size, page: 1 }),
					})
				}
				onPageChange={(next, options) =>
					void navigate({
						search: (prev) => ({ ...prev, page: next }),
						replace: options?.replace,
					})
				}
			/>
```

Import: via `DataPagination`, `PageSizeSelector`, `dataPaginationLabels`; aggiungi
`import { DataTableFooter } from "@bibs/ui/custom/data-table-footer";`,
`import { PageHeader } from "@bibs/ui/custom/page-header";`, `dataTableFooterLabels` da `@/lib/ui-labels`.

- [ ] **Step 3: `products` — header, ricerca, piede**

Header: sostituisci `<div className="flex shrink-0 items-center justify-between"><div><h1 …>{m.products_page_title()}</h1><p …>…</p></div><CreateButton …/></div>` con:

```tsx
			<PageHeader
				title={m.products_page_title()}
				description={
					activeStore
						? m.products_page_subtitle()
						: m.products_page_subtitle_no_store()
				}
			>
				<CreateButton asChild>
					<Link to="/products/new">{m.products_new_cta()}</Link>
				</CreateButton>
			</PageHeader>
```

Ricerca: elimina `localQ`/`setLocalQ`, `debouncedQ` e i due `useEffect` (righe ~164-184, commento compreso); tieni `const effectiveRouteQ = routeQ ?? "";`. Sostituisci l'`<InputGroup className="max-w-md min-w-[240px] flex-1">…</InputGroup>` con:

```tsx
						<SearchInput
							value={effectiveRouteQ}
							onValueChange={(q) =>
								void navigate({
									search: (prev) => ({
										...prev,
										q: q.length > 0 ? q : undefined,
										page: 1,
									}),
								})
							}
							placeholder={m.products_search_placeholder()}
							aria-label={m.products_search_placeholder()}
							clearLabel={m.products_search_clear()}
							className="max-w-md min-w-[240px] flex-1"
						/>
```

Piede: come Step 2 con `m.products_pagination_range_one` / `m.products_pagination_range`.

Import: via `InputGroup*`, `useDebouncedValue`, `DataPagination`, `PageSizeSelector`, `dataPaginationLabels`, `SearchIcon`/`XIcon` e `useEffect`/`useState` **se** non più usati nel file (lascia decidere a `bun run typecheck` + Biome). Aggiungi `SearchInput`, `DataTableFooter`, `PageHeader`, `dataTableFooterLabels`.

- [ ] **Step 4: `promotions` — header e piede**

Header con `PageHeader` (`title={m.promotions_page_title()}`, `description={m.promotions_page_subtitle()}`, children = il `CreateButton` esistente verso `/promotions/new`). Piede come Step 2 con `m.promotions_pagination_range_one` / `m.promotions_pagination_range`. Import come Step 2.

- [ ] **Step 5: `team` — header, piede, padding**

Header: `PageHeader` con `title={m.team_title()}`, `description={isOwner ? m.team_subtitle() : m.team_subtitle_readonly()}`, children `{isOwner && <InviteEmployeeDialog />}`.

Piede: sostituisci il blocco (commento «Stesso piede di /products…» compreso) con:

```tsx
			{/* Range e totale contano solo i dipendenti: titolare e inviti stanno
			    fuori dalla paginazione. */}
			<DataTableFooter
				page={page}
				pageSize={limit}
				total={data?.pagination.total ?? 0}
				rangeLabel={(r) =>
					(r.total === 1
						? m.team_pagination_range_one
						: m.team_pagination_range)(r)
				}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) =>
					void navigate({ search: { page: 1, limit: size } })
				}
				onPageChange={(p, options) =>
					void navigate({
						search: { page: p, limit },
						replace: options?.replace,
					})
				}
			/>
```

Se `totalPages` non è più usato altrove, eliminalo. Padding: nella prima colonna `headerClassName: "w-[30%] pl-6"` → `"w-[30%]"`, `cellClassName: "pl-6"` → togli la chiave; nell'ultima `headerClassName: "w-[12%] pr-6 text-right"` → `"w-[12%] text-right"`, `cellClassName: "pr-6 text-right"` → `"text-right"`.

- [ ] **Step 6: Typecheck, lint, test seller**

Run: `bun run typecheck && bun run lint && bun run --filter @bibs/seller test`
Expected: exit 0 (controlla l'exit del workspace, non solo l'aggregato).

- [ ] **Step 7: Diff del DOM**

Ripeti lo Step 1 salvando `dom-after-<pagina>.html`; poi `diff` per pagina.
Expected — sole differenze ammesse:
- `orders`: wrapper del titolo `class="shrink-0"` → `class="flex shrink-0 items-center justify-between"` + `<div>` interno.
- `team`: spariscono `pl-6`/`pr-6` da prima e ultima colonna.
- ordine attributi o id generati da React (`:r…:`) se presenti.
Qualunque altra differenza è un bug: correggilo prima di procedere.

Prova a mano su `/products`: scrivi «ab», attendi, URL `?q=ab`; Indietro → campo vuoto e URL senza `q` (non torna `ab`).

- [ ] **Step 8: Commit**

```bash
git add apps/seller/src/routes/_authenticated/orders/index.tsx apps/seller/src/routes/_authenticated/products/index.tsx apps/seller/src/routes/_authenticated/promotions/index.tsx apps/seller/src/routes/_authenticated/team/index.tsx
git commit -m "refactor(seller): liste su PageHeader, SearchInput e DataTableFooter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shell admin, users e sellers

**Files:**
- Modify: `apps/admin/src/routes/_authenticated.tsx:64-84`
- Modify: `apps/admin/src/routes/_authenticated/users.tsx`
- Modify: `apps/admin/src/routes/_authenticated/sellers/index.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `SearchInput`, `DataTableFooter`, `dataTableFooterLabels`.

- [ ] **Step 1: Shell come seller**

In `_authenticated.tsx` sostituisci header e wrapper:

```tsx
			<SidebarInset>
				<header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
					<SidebarTrigger className="-ml-1" label={m.shell_sidebar_toggle()} />
					<div aria-hidden className="h-4 w-px bg-border" />
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbPage>bibs Admin</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				</header>
				{/* clip, non hidden: hidden ne fa un contenitore di scroll che
				    non scorre mai (scorre la finestra) e blocca ogni `sticky`. */}
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip p-4">
					<Outlet />
				</div>
			</SidebarInset>
```

Togli l'import di `Separator` se non più usato.

- [ ] **Step 2: `users`**

- `PageHeader` da `@bibs/ui/custom/page-header` (stesse props di oggi).
- Ricerca: elimina `localQ`, `debouncedQ` e i due `useEffect` (commento compreso); tieni `const effectiveQ = routeQ ?? "";`. Sostituisci l'`<InputGroup className="max-w-md">…</InputGroup>` con:

```tsx
			<SearchInput
				value={effectiveQ}
				onValueChange={(q) =>
					void navigate({
						search: (prev) => ({
							...prev,
							q: q.length > 0 ? q : undefined,
							page: 1,
						}),
					})
				}
				placeholder={m.users_search_placeholder()}
				aria-label={m.users_search_label()}
				clearLabel={m.common_clear_search()}
				className="max-w-md"
			/>
```

- Piede: sostituisci `{total > 0 && (<div …>…</div>)}` con `DataTableFooter` (`total={total}`, `rangeLabel` su `m.users_pagination_range_one` / `m.users_pagination_range`, `onPageSizeChange`/`onPageChange` con gli stessi `navigate` di oggi, `labels={dataTableFooterLabels()}`). Se `totalPages`/`offset` restano inutilizzati, eliminali (`offset` serve ancora alla query: tienilo).
- Padding: colonna `name` → `meta: { menuLabel: m.common_name(), cellClassName: "font-semibold" }`; colonna `actions` → `meta: { headerClassName: "w-12 text-right", cellClassName: "text-right" }`.
- Import: via `InputGroup*`, `SearchIcon`, `XIcon`, `useDebouncedValue`, `useEffect`, `useState`, `DataPagination`, `PageSizeSelector`, `dataPaginationLabels`, `@/components/page-header`.

- [ ] **Step 3: `sellers/index`**

Lo stato resta locale (non in URL), come oggi:

```tsx
	const [search, setSearch] = useState("");
```

Elimina `debouncedSearch` e il `useEffect` «La ricerca deboundata riporta sempre alla prima pagina»; sostituisci ogni `debouncedSearch` con `search` (queryKey, query, `hideHeaderWhenEmpty`, `emptyState`). L'effetto di cambio tab che fa `setSearch("")` resta: `SearchInput` segue `value`.

Ricerca:

```tsx
			<SearchInput
				value={search}
				onValueChange={(q) => {
					setSearch(q);
					setPage(1);
				}}
				placeholder={m.sellers_search_placeholder()}
				aria-label={m.sellers_search_label()}
				clearLabel={m.common_clear_search()}
				className="max-w-md"
			/>
```

Piede: `DataTableFooter` con `total={data?.pagination.total ?? 0}`, `rangeLabel` su `m.sellers_pagination_range_one` / `m.sellers_pagination_range`, `onPageSizeChange={(size) => { setLimit(size); setPage(1); }}`, `onPageChange={setPage}`.

Padding: `name` → `meta: { menuLabel: m.sellers_column_seller(), cellClassName: "font-semibold" }`; `actions` → `meta: { headerClassName: "text-right", cellClassName: "text-right" }`; `toggle` → `meta: { headerClassName: "w-12 text-right" }`.

`PageHeader` da `@bibs/ui/custom/page-header`. Import come Step 2.

- [ ] **Step 4: Typecheck, lint, test admin**

Run: `bun run typecheck && bun run lint && bun run --filter @bibs/admin test`
Expected: exit 0.

- [ ] **Step 5: Browser**

Admin `:3003` (sessione admin). Su `/users` e `/sellers`: header sticky al scroll; titolo in `font-display`; ricerca → URL/risultati; su `/users` Indietro dopo una ricerca svuota il campo e resta senza `q`; ordinamento; piede; tab sellers azzerano la ricerca; dark mode. Screenshot e aprili.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/routes/_authenticated.tsx apps/admin/src/routes/_authenticated/users.tsx apps/admin/src/routes/_authenticated/sellers/index.tsx
git commit -m "refactor(admin): shell, utenti e venditori sul kit liste seller

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Configurazioni — `CategoryCrudPanel`, caratteristiche, festività

**Files:**
- Modify: `apps/admin/src/features/crud/category-crud-panel.tsx`
- Modify: `apps/admin/src/features/{store-macro-categories,store-categories,product-macro-categories,product-categories,product-characteristics}/*.config.tsx` (togli `emptyIcon`)
- Modify: `apps/admin/src/features/category-characteristics/components/category-characteristics-panel.tsx`
- Modify: `apps/admin/src/features/holidays/components/holidays-panel.tsx` (solo padding)
- Delete: `packages/ui/src/custom/sortable-table-head.tsx`

**Interfaces:**
- Consumes: `SortableHeader` e `manualSorting` di `@bibs/ui/custom/data-table`; `SearchInput`, `DataTableFooter`, `EmptyState`.
- Produces: `CategoryCrudConfig` **senza** `emptyIcon`.

- [ ] **Step 1: Ordinamento con `SortableHeader`**

In `category-crud-panel.tsx` sostituisci `handleSort` con:

```tsx
	const sorting: SortingState = [{ id: sortBy, desc: sortOrder === "desc" }];

	const onSortingChange = (next: SortingState) => {
		const head = next[0];
		if (head) {
			setSortBy(head.id as SortByField);
			setSortOrder(head.desc ? "desc" : "asc");
		} else {
			// Il terzo clic toglie l'ordinamento: torna al default (nome A→Z).
			setSortBy("name");
			setSortOrder("asc");
		}
		setPage(1);
	};
```

Colonne `name` e `createdAt`: aggiungi `enableSorting: true` e sostituisci gli header:

```tsx
			header: ({ column }) => (
				<SortableHeader column={column}>{m.common_name()}</SortableHeader>
			),
```

```tsx
			header: ({ column }) => (
				<SortableHeader column={column}>
					{m.crud_column_created_at()}
				</SortableHeader>
			),
```

Padding: `name` → `meta: { menuLabel: m.common_name(), cellClassName: "font-semibold" }`; `actions` → `meta: { headerClassName: "text-right", cellClassName: "text-right" }`. Le dipendenze di `useMemo` delle colonne diventano `[config]`.

Sul `DataTable`: `manualSorting={{ sorting, onSortingChange }}`.

Import: `import { DataTable, SortableHeader } from "@bibs/ui/custom/data-table";`, `import type { SortingState } from "@tanstack/react-table";`; via `SortableHeadButton` e il `SortOrder` di `sortable-table-head` (se `SortOrder` serve ancora, dichiaralo locale: `type SortOrder = "asc" | "desc";`).

- [ ] **Step 2: Ricerca, vuoto, piede**

Stato ricerca confermato:

```tsx
	const [search, setSearch] = useState("");
```

Elimina `debouncedSearch` e usa `search` in queryKey e query. Sostituisci il `<div className="relative flex-1">…<Input …/></div>` con:

```tsx
				<SearchInput
					value={search}
					onValueChange={(q) => {
						setSearch(q);
						setPage(1);
					}}
					placeholder={labels.searchPlaceholder}
					aria-label={labels.searchPlaceholder}
					clearLabel={m.common_clear_search()}
					className="flex-1"
				/>
```

Vuoto:

```tsx
	const isFiltered = search.length > 0 || Object.keys(activeFilters).length > 0;
```

```tsx
				hideHeaderWhenEmpty={!isFiltered}
				emptyState={
					isFiltered ? (
						<EmptyState variant="no-results" title={m.common_no_results()} />
					) : (
						<EmptyState
							title={labels.empty.title}
							description={labels.empty.subtitle}
						/>
					)
				}
```

Piede: sostituisci `{data?.pagination && data.pagination.total > 0 && (…)}` con:

```tsx
			<DataTableFooter
				page={page}
				pageSize={limit}
				total={data?.pagination.total ?? 0}
				rangeLabel={(r) => labels.total(r.total)}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) => {
					setLimit(size);
					setPage(1);
				}}
				onPageChange={setPage}
			/>
```

Togli `emptyIcon: ReactNode;` da `CategoryCrudConfig` e la riga `emptyIcon: <… />` (con l'import dell'icona, se resta inutilizzato) dalle 5 config. Import nel pannello: via `Input`, `SearchIcon`, `useDebouncedValue`, `DataPagination`, `PageSizeSelector`, `dataPaginationLabels`; aggiungi `SearchInput`, `DataTableFooter`, `EmptyState`, `dataTableFooterLabels`.

- [ ] **Step 3: `CategoryCharacteristicsPanel` e `HolidaysPanel`**

Caratteristiche: sostituisci il blocco con icona assoluta + `<Input placeholder={m.characteristics_search()} … className="pl-9" />` con:

```tsx
				<SearchInput
					value={search}
					onValueChange={setSearch}
					placeholder={m.characteristics_search()}
					aria-label={m.characteristics_search()}
					clearLabel={m.common_clear_search()}
				/>
```

(mantieni il wrapper esterno se dà larghezza; togli `SearchIcon`/`Input` se inutilizzati). Padding: `meta: { cellClassName: "pl-4", headerClassName: "pl-4" }` → togli la meta; `meta: { cellClassName: "w-28 pr-4", headerClassName: "pr-4" }` → `meta: { cellClassName: "w-28" }`.

Festività: prima colonna `cellClassName: "pl-6 font-semibold"` → `"font-semibold"` e togli eventuale `headerClassName` con `pl-*`; ultima `cellClassName: "pr-6 text-right"` → `"text-right"` e `headerClassName` senza `pr-6`.

- [ ] **Step 4: Cancella `SortableHeadButton`**

Run: `grep -rn "sortable-table-head" apps packages --include=*.tsx --include=*.ts`
Expected: nessun risultato. Poi `git rm packages/ui/src/custom/sortable-table-head.tsx`.

- [ ] **Step 5: Typecheck, lint, test admin**

Run: `bun run typecheck && bun run lint && bun run --filter @bibs/admin test`
Expected: exit 0. Se `category-characteristics.test.tsx` cerca il vecchio input, aggiorna la query del test al ruolo `textbox` con nome `m.characteristics_search()`.

- [ ] **Step 6: Browser**

`/configurations`, una tab per tipo (macro prodotto, categorie prodotto, caratteristiche, macro negozio, categorie negozio): header ordinabili in maiuscoletto, ordinamento nome/data, ricerca con «cancella», vuoto filtrato vs vuoto vero, piede, filtro toolbar (categorie) che riporta a pagina 1, CRUD crea/modifica/elimina ancora funzionante (su entità di prova, non sul seed), dialog «caratteristiche» con ricerca, tab festività.

- [ ] **Step 7: Commit**

```bash
git add -A apps/admin/src/features packages/ui/src/custom/sortable-table-head.tsx
git commit -m "refactor(admin): configurazioni sul kit liste, via SortableHeadButton

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Abbonamenti su `DataTable` e `PageHeader` condiviso ovunque

**Files:**
- Modify: `apps/admin/src/routes/_authenticated/billing/subscriptions.tsx`
- Modify: `apps/admin/src/routes/_authenticated/{billing,configurations,products,collections,stores}.tsx` (import `PageHeader`)
- Delete: `apps/admin/src/components/page-header.tsx`

**Interfaces:**
- Consumes: `DataTable`, `TableColumnsToggle`, `SearchInput`, `DataTableFooter`, `EmptyState`, `subscriptionStatusBadge` (`@/features/billing/subscription-status`).

- [ ] **Step 1: Riscrivi la lista abbonamenti**

Mantieni query, `formatDate` locale e stati `sellerEmail`/`storeName`/`page`/`limit`. Corpo del componente dopo `const isFiltered = …`:

```tsx
	type Row = (typeof rows)[number];

	const columns: DataTableColumnDef<Row>[] = [
		{
			id: "seller",
			header: m.billing_subs_col_seller(),
			enableHiding: false,
			cell: ({ row }) => row.original.sellerEmail,
		},
		{
			id: "store",
			header: m.billing_subs_col_store(),
			meta: { cellClassName: "font-semibold" },
			cell: ({ row }) => row.original.storeName,
		},
		{
			id: "status",
			header: m.common_status(),
			meta: { menuLabel: m.common_status() },
			cell: ({ row }) => {
				const badge = subscriptionStatusBadge(row.original.status);
				return <Badge variant={badge.variant}>{badge.label}</Badge>;
			},
		},
		{
			id: "fee",
			header: m.billing_subs_col_fee(),
			meta: { cellClassName: "tabular-nums" },
			cell: ({ row }) => formatPriceEur(row.original.feeAmountCents / 100),
		},
		{
			id: "renewal",
			header: m.billing_subs_col_renewal(),
			meta: { cellClassName: "text-muted-foreground text-sm" },
			cell: ({ row }) => formatDate(row.original.currentPeriodEnd),
		},
		{
			id: "created",
			header: m.billing_subs_col_created(),
			meta: { cellClassName: "text-muted-foreground text-sm" },
			cell: ({ row }) => formatDate(row.original.createdAt),
		},
		{
			id: "toggle",
			enableHiding: false,
			meta: { headerClassName: "w-12 text-right" },
			header: ({ table }) => (
				<TableColumnsToggle
					table={table}
					labels={tableColumnsToggleLabels()}
					align="end"
				/>
			),
			cell: () => null,
		},
	];

	const setFilter = (set: (v: string) => void) => (v: string) => {
		set(v);
		setPage(1);
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap gap-2">
				<SearchInput
					value={sellerEmail}
					onValueChange={setFilter(setSellerEmail)}
					placeholder={m.billing_subs_search_email()}
					aria-label={m.billing_subs_search_email()}
					clearLabel={m.common_clear_search()}
					className="max-w-xs"
				/>
				<SearchInput
					value={storeName}
					onValueChange={setFilter(setStoreName)}
					placeholder={m.billing_subs_search_store()}
					aria-label={m.billing_subs_search_store()}
					clearLabel={m.common_clear_search()}
					className="max-w-xs"
				/>
			</div>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						{m.common_load_error_with_message({ message: error.message })}
					</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="admin.billing.subscriptions.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				hideHeaderWhenEmpty={!isFiltered}
				emptyState={
					isFiltered ? (
						<EmptyState
							variant="no-results"
							title={m.common_no_results()}
							description={m.billing_subs_no_results_description()}
							action={
								<Button
									variant="outline"
									onClick={() => {
										setSellerEmail("");
										setStoreName("");
										setPage(1);
									}}
								>
									{m.common_clear_search()}
								</Button>
							}
						/>
					) : (
						<EmptyState
							title={m.billing_subs_empty_title()}
							description={m.billing_subs_empty_description()}
						/>
					)
				}
			/>

			<DataTableFooter
				page={page}
				pageSize={limit}
				total={total}
				rangeLabel={(r) =>
					(r.total === 1 ? m.billing_subs_range_one : m.billing_subs_range)(r)
				}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) => {
					setLimit(size);
					setPage(1);
				}}
				onPageChange={setPage}
			/>
		</div>
	);
```

Elimina `totalPages` e `offset` se inutilizzati. Import: via `Input`, `Spinner`, `Table*`, `DataPagination`, `PageSizeSelector`, `dataPaginationLabels`; aggiungi `DataTable`, `TableColumnsToggle`, `SearchInput`, `DataTableFooter`, `type DataTableColumnDef` (`@bibs/ui/lib/table-features`), `dataTableFooterLabels`, `tableColumnsToggleLabels`. Il componente deve avere `"use no memo";` come prima riga (columns con `header` che legge `table`, come le altre liste admin).

- [ ] **Step 2: `PageHeader` condiviso**

In `billing.tsx`, `configurations.tsx`, `products.tsx`, `collections.tsx`, `stores.tsx`: `import { PageHeader } from "@/components/page-header";` → `import { PageHeader } from "@bibs/ui/custom/page-header";`. Poi:

Run: `grep -rn "@/components/page-header" apps/admin/src`
Expected: nessun risultato. `git rm apps/admin/src/components/page-header.tsx`.

- [ ] **Step 3: Typecheck, lint, test**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: exit 0 per ogni workspace.

- [ ] **Step 4: Browser**

`/billing/subscriptions`: tabella con bordo/card come le altre, toggle colonne, due ricerche con debounce (una sola richiesta per parola nella tab Network), vuoto filtrato con «Cancella ricerca», piede. Titoli di `/billing`, `/configurations`, `/products`, `/collections`, `/stores` in `font-display`. Dark mode.

- [ ] **Step 5: Commit**

```bash
git add -A apps/admin/src/routes apps/admin/src/components/page-header.tsx
git commit -m "refactor(admin): abbonamenti su DataTable, PageHeader da @bibs/ui

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Chiusura PR 1

- [ ] **Step 1: Verifica completa**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: exit 0; controlla l'esito per workspace.

- [ ] **Step 2: Smoke di Marco**

Chiedi a Marco di provare `/users`, `/sellers`, `/configurations`, `/billing/subscriptions` (admin) e `/products`, `/orders` (seller) con mouse e tastiera. Aspetta l'ok.

- [ ] **Step 3: PR**

Usa `superpowers:finishing-a-development-branch`, poi `/commit-commands:commit-push-pr`. Titolo: `refactor: kit liste condiviso tra admin e seller`. Body: problema (tabella della spec), pezzi nuovi, cosa è stato cancellato, verifica (DOM diff seller, browser admin), fuori scope. Chiudi con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

# PR 2 — Negozi in admin (`feat/admin-stores`)

Parti da `main` aggiornato **dopo** il merge di PR 1 (`git fetch --prune && git checkout main && git pull && git checkout -b feat/admin-stores`). Se PR 1 è ancora aperta, crea il branch da `refactor/shared-list-kit` e, dopo il merge di PR 1, fai il retarget della PR 2 su `main` **prima** di cancellare il branch di PR 1.

### Task 8: Servizio `listStores` / `countStoresByStatus`

**Files:**
- Modify: `apps/api/src/lib/queries.ts`
- Modify: `apps/api/src/lib/schemas/composed.ts`
- Create: `apps/api/src/modules/admin/services/stores.ts`
- Test: `apps/api/tests/integration/admin-stores.test.ts`

**Interfaces:**
- Produces:
  - `adminStoreStatuses = ["all","active","past_due","suspended","none","deleted"] as const`, `type AdminStoreStatus`, `StoreListQuery` (TypeBox) da `@/lib/queries`.
  - `AdminStoreListItemSchema` da `@/lib/schemas`.
  - `listStores(params: ListStoresParams): Promise<{ data: AdminStoreRow[]; pagination: { page: number; limit: number; total: number } }>` e `countStoresByStatus(): Promise<Record<AdminStoreStatus, number>>` da `@/modules/admin/services/stores`.
  - Riga: `{ id: string; name: string; sellerProfileId: string; businessName: string | null; categoryName: string | null; municipality: { name: string; provinceAcronym: string }; subscriptionStatus: StoreSubscriptionStatus | null; createdAt: Date; deletedAt: Date | null }`.

- [ ] **Step 1: Query e schema**

In `apps/api/src/lib/queries.ts`, in fondo:

```ts
/** Tab della lista negozi admin. `all` = negozi vivi; `deleted` = eliminati. */
export const adminStoreStatuses = [
	"all",
	"active",
	"past_due",
	"suspended",
	"none",
	"deleted",
] as const;
export type AdminStoreStatus = (typeof adminStoreStatuses)[number];

/**
 * Pagination + tab/search/sort for the admin store list.
 */
export const StoreListQuery = t.Object({
	...PaginationQuery.properties,
	status: t.Optional(
		t.Union(
			adminStoreStatuses.map((s) => t.Literal(s)),
			{
				default: "all",
				description:
					"Tab: all (negozi vivi), active (abbonamento attivo o in cancellazione), past_due, suspended, none (senza abbonamento o cancellato), deleted (eliminati)",
			},
		),
	),
	search: t.Optional(
		t.String({
			maxLength: 100,
			description:
				"Ricerca testuale su nome negozio, ragione sociale del venditore o comune",
		}),
	),
	sortBy: t.Optional(
		t.Union([t.Literal("name"), t.Literal("createdAt")], {
			default: "createdAt",
			description: "Campo di ordinamento",
		}),
	),
	sortOrder: t.Optional(
		t.Union([t.Literal("asc"), t.Literal("desc")], {
			default: "desc",
			description: "Direzione di ordinamento",
		}),
	),
});
```

In `apps/api/src/lib/schemas/composed.ts`, aggiungi l'import
`import { storeSubscriptionStatuses } from "@/db/schemas/store-subscription";` e in fondo:

```ts
export const AdminStoreListItemSchema = t.Object(
	{
		id: t.String({ description: "ID del negozio" }),
		name: t.String({ description: "Nome del negozio" }),
		sellerProfileId: t.String({
			description: "ID del profilo venditore titolare",
		}),
		businessName: t.Nullable(
			t.String({ description: "Ragione sociale del venditore" }),
		),
		categoryName: t.Nullable(
			t.String({ description: "Categoria del negozio" }),
		),
		municipality: t.Object({
			name: t.String({ description: "Nome del comune" }),
			provinceAcronym: t.String({ description: "Sigla della provincia" }),
		}),
		subscriptionStatus: t.Nullable(
			t.Union(
				storeSubscriptionStatuses.map((s) => t.Literal(s)),
				{ description: "Stato dell'abbonamento; null se mai sottoscritto" },
			),
		),
		createdAt: t.Date({ description: "Data di creazione" }),
		deletedAt: t.Nullable(t.Date({ description: "Data di eliminazione" })),
	},
	{
		description:
			"Negozio nella lista admin, con venditore, comune e stato dell'abbonamento",
	},
);
```

- [ ] **Step 2: Scrivi il test che fallisce**

`apps/api/tests/integration/admin-stores.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import { eq } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import type { StoreSubscriptionStatus } from "@/db/schemas/store-subscription";
import { adminStoreStatuses } from "@/lib/queries";
import {
	countStoresByStatus,
	listStores,
} from "@/modules/admin/services/stores";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestMunicipality,
	createTestOrganization,
	createTestSeller,
	createTestStore,
	createTestStoreCategory,
	createTestStoreSubscription,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

/**
 * Rossi SRL (Bologna): un negozio per stato di abbonamento + uno senza + uno
 * eliminato. Bianchi SNC (Modena): «Bottega», senza abbonamento. Un venditore
 * senza organization: «Orfano».
 */
async function seed() {
	const db = getTestDb();
	const bologna = await createTestMunicipality(db, {
		municipalityName: "Bologna",
		provinceName: "Bologna",
		provinceAcronym: "BO",
	});
	const modena = await createTestMunicipality(db, {
		municipalityName: "Modena",
		provinceName: "Modena",
		provinceAcronym: "MO",
	});
	const alimentari = await createTestStoreCategory(db, "Alimentari");

	const rossi = await createTestSeller(db);
	await createTestOrganization(db, rossi.profile.id, { businessName: "Rossi SRL" });
	const atRossi = (
		name: string,
		status?: StoreSubscriptionStatus,
		categoryId?: string,
	) =>
		createTestStore(db, rossi.profile.id, {
			name,
			municipalityId: bologna.id,
			categoryId,
		}).then(async (s) => {
			if (status) await createTestStoreSubscription(db, s.id, { status });
			return s;
		});

	await atRossi("Attivo", "active", alimentari.id);
	await atRossi("In cancellazione", "canceling");
	await atRossi("Insoluto", "past_due");
	await atRossi("Sospeso", "suspended");
	await atRossi("Cancellato", "canceled");
	await atRossi("Senza");
	const eliminato = await atRossi("Eliminato", "active");
	await db
		.update(store)
		.set({ deletedAt: new Date() })
		.where(eq(store.id, eliminato.id));

	const bianchi = await createTestSeller(db);
	await createTestOrganization(db, bianchi.profile.id, {
		businessName: "Bianchi SNC",
	});
	await createTestStore(db, bianchi.profile.id, {
		name: "Bottega",
		municipalityId: modena.id,
	});

	const orfano = await createTestSeller(db);
	await createTestStore(db, orfano.profile.id, {
		name: "Orfano",
		municipalityId: bologna.id,
	});
}

const names = async (params: Parameters<typeof listStores>[0]) =>
	(await listStores({ limit: 100, ...params })).data.map((s) => s.name).sort();

describe("listStores — tab", () => {
	it("all: solo negozi vivi", async () => {
		await seed();
		expect(await names({})).toEqual(
			["Attivo", "Bottega", "Cancellato", "In cancellazione", "Insoluto", "Orfano", "Senza", "Sospeso"],
		);
	});

	it("active: attivo e in cancellazione, non l'eliminato con abbonamento attivo", async () => {
		await seed();
		expect(await names({ status: "active" })).toEqual(["Attivo", "In cancellazione"]);
	});

	it("past_due e suspended", async () => {
		await seed();
		expect(await names({ status: "past_due" })).toEqual(["Insoluto"]);
		expect(await names({ status: "suspended" })).toEqual(["Sospeso"]);
	});

	it("none: senza abbonamento o cancellato", async () => {
		await seed();
		expect(await names({ status: "none" })).toEqual(["Bottega", "Cancellato", "Orfano", "Senza"]);
	});

	it("deleted: solo gli eliminati, con la data", async () => {
		await seed();
		const { data } = await listStores({ status: "deleted" });
		expect(data.map((s) => s.name)).toEqual(["Eliminato"]);
		expect(data[0].deletedAt).toBeInstanceOf(Date);
	});
});

describe("listStores — riga", () => {
	it("venditore, categoria, comune e abbonamento", async () => {
		await seed();
		const { data } = await listStores({ search: "Attivo" });
		expect(data[0]).toMatchObject({
			name: "Attivo",
			businessName: "Rossi SRL",
			categoryName: "Alimentari",
			municipality: { name: "Bologna", provinceAcronym: "BO" },
			subscriptionStatus: "active",
			deletedAt: null,
		});
	});

	it("senza organization e senza categoria: c'è, con null", async () => {
		await seed();
		const { data } = await listStores({ search: "Orfano" });
		expect(data).toHaveLength(1);
		expect(data[0]).toMatchObject({
			businessName: null,
			categoryName: null,
			subscriptionStatus: null,
		});
	});
});

describe("listStores — ricerca e ordinamento", () => {
	it("cerca su nome negozio, ragione sociale e comune", async () => {
		await seed();
		expect(await names({ search: "bott" })).toEqual(["Bottega"]);
		expect(await names({ search: "bianchi" })).toEqual(["Bottega"]);
		expect(await names({ search: "moden" })).toEqual(["Bottega"]);
	});

	it("% e _ sono letterali", async () => {
		await seed();
		expect(await names({ search: "%" })).toEqual([]);
		expect(await names({ search: "_" })).toEqual([]);
	});

	it("ordina per nome", async () => {
		await seed();
		const { data } = await listStores({ status: "none", sortBy: "name", sortOrder: "asc" });
		expect(data.map((s) => s.name)).toEqual(["Bottega", "Cancellato", "Orfano", "Senza"]);
	});

	it("pagina", async () => {
		await seed();
		const page2 = await listStores({ page: 2, limit: 3, sortBy: "name", sortOrder: "asc" });
		expect(page2.pagination).toEqual({ page: 2, limit: 3, total: 8 });
		expect(page2.data.map((s) => s.name)).toEqual(["In cancellazione", "Insoluto", "Orfano"]);
	});
});

describe("countStoresByStatus", () => {
	it("coincide con il totale della lista per ogni tab", async () => {
		await seed();
		const counts = await countStoresByStatus();
		expect(counts).toEqual({ all: 8, active: 2, past_due: 1, suspended: 1, none: 4, deleted: 1 });
		for (const status of adminStoreStatuses) {
			const { pagination } = await listStores({ status });
			expect(counts[status]).toBe(pagination.total);
		}
	});
});
```

- [ ] **Step 3: Verifica che fallisca**

Run: `cd apps/api && bun run test:image && bun test tests/integration/admin-stores.test.ts --timeout 180000`
Expected: FAIL — `Cannot find module '@/modules/admin/services/stores'`.

- [ ] **Step 4: Implementa il servizio**

`apps/api/src/modules/admin/services/stores.ts`:

```ts
import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { organization } from "@/db/schemas/organization";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import {
	type StoreSubscriptionStatus,
	storeSubscription,
} from "@/db/schemas/store-subscription";
import { containsPattern } from "@/lib/like";
import { parsePagination } from "@/lib/pagination";
import type { AdminStoreStatus } from "@/lib/queries";

const alive = isNull(store.deletedAt);
const subIs = (...statuses: StoreSubscriptionStatus[]) =>
	inArray(storeSubscription.status, statuses);

// Una sola definizione per tab, condivisa da lista e conteggi: i numeri delle
// tab non possono divergere dalle righe. Presuppone la LEFT JOIN su
// store_subscription (al più una riga per negozio).
const STATUS_WHERE: Record<AdminStoreStatus, SQL> = {
	all: alive,
	active: sql`${alive} and ${subIs("active", "canceling")}`,
	past_due: sql`${alive} and ${subIs("past_due")}`,
	suspended: sql`${alive} and ${subIs("suspended")}`,
	none: sql`${alive} and (${isNull(storeSubscription.id)} or ${subIs("canceled")})`,
	deleted: isNotNull(store.deletedAt),
};

export interface ListStoresParams {
	page?: number;
	limit?: number;
	status?: AdminStoreStatus;
	search?: string;
	sortBy?: "name" | "createdAt";
	sortOrder?: "asc" | "desc";
}

export async function listStores(params: ListStoresParams) {
	const { page, limit, offset } = parsePagination(params);

	const term = params.search ? containsPattern(params.search) : undefined;
	const where = and(
		STATUS_WHERE[params.status ?? "all"],
		term
			? or(
					ilike(store.name, term),
					ilike(organization.businessName, term),
					ilike(municipality.name, term),
				)
			: undefined,
	);

	const dir = params.sortOrder === "asc" ? asc : desc;
	const sortCol = params.sortBy === "name" ? store.name : store.createdAt;

	// Organization, categoria e abbonamento possono mancare: LEFT JOIN, così il
	// negozio resta in lista con null.
	const [data, [{ total }]] = await Promise.all([
		db
			.select({
				id: store.id,
				name: store.name,
				sellerProfileId: store.sellerProfileId,
				businessName: organization.businessName,
				categoryName: storeCategory.name,
				municipality: {
					name: municipality.name,
					provinceAcronym: province.acronym,
				},
				subscriptionStatus: storeSubscription.status,
				createdAt: store.createdAt,
				deletedAt: store.deletedAt,
			})
			.from(store)
			.innerJoin(municipality, eq(municipality.id, store.municipalityId))
			.innerJoin(province, eq(province.id, municipality.provinceId))
			.leftJoin(
				organization,
				eq(organization.sellerProfileId, store.sellerProfileId),
			)
			.leftJoin(storeCategory, eq(storeCategory.id, store.categoryId))
			.leftJoin(storeSubscription, eq(storeSubscription.storeId, store.id))
			.where(where)
			.orderBy(dir(sortCol), asc(store.id))
			.limit(limit)
			.offset(offset),
		db
			.select({ total: count() })
			.from(store)
			.innerJoin(municipality, eq(municipality.id, store.municipalityId))
			.leftJoin(
				organization,
				eq(organization.sellerProfileId, store.sellerProfileId),
			)
			.leftJoin(storeSubscription, eq(storeSubscription.storeId, store.id))
			.where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

export async function countStoresByStatus(): Promise<
	Record<AdminStoreStatus, number>
> {
	const countWhere = (w: SQL) =>
		sql<number>`count(*) filter (where ${w})`.mapWith(Number);

	const [row] = await db
		.select({
			all: countWhere(STATUS_WHERE.all),
			active: countWhere(STATUS_WHERE.active),
			past_due: countWhere(STATUS_WHERE.past_due),
			suspended: countWhere(STATUS_WHERE.suspended),
			none: countWhere(STATUS_WHERE.none),
			deleted: countWhere(STATUS_WHERE.deleted),
		})
		.from(store)
		.leftJoin(storeSubscription, eq(storeSubscription.storeId, store.id));

	return row;
}
```

- [ ] **Step 5: Verifica che passi**

Run: `cd apps/api && bun test tests/integration/admin-stores.test.ts --timeout 180000`
Expected: PASS, 12 test. Se l'ordine per nome differisce per collation, non cambiare i nomi del seed: controlla prima la collation del container (`SHOW lc_collate`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/queries.ts apps/api/src/lib/schemas/composed.ts apps/api/src/modules/admin/services/stores.ts apps/api/tests/integration/admin-stores.test.ts
git commit -m "feat(api): lista e conteggi negozi per l'admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Rotte `/admin/stores` e `/admin/stores/counts`

**Files:**
- Create: `apps/api/src/modules/admin/routes/stores.ts`
- Modify: `apps/api/src/modules/admin/index.ts`

**Interfaces:**
- Consumes: `listStores`, `countStoresByStatus` (Task 8), `StoreListQuery`, `AdminStoreListItemSchema`.
- Produces: Eden `api().admin.stores.get({ query })` → `{ success, data: AdminStoreRow[], pagination }`; `api().admin.stores.counts.get()` → `{ success, data: Record<AdminStoreStatus, number> }`.

- [ ] **Step 1: Rotte**

`apps/api/src/modules/admin/routes/stores.ts`:

```ts
import { Elysia, t } from "elysia";
import { StoreListQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	AdminStoreListItemSchema,
	okPageRes,
	okRes,
	withErrors,
} from "@/lib/schemas";
import { countStoresByStatus, listStores } from "../services/stores";

const count = (description: string) => t.Integer({ minimum: 0, description });

export const storesRoutes = new Elysia()
	.get(
		"/stores/counts",
		async () => ok(await countStoresByStatus()),
		{
			response: withErrors({
				200: okRes(
					t.Object({
						all: count("Negozi vivi"),
						active: count("Abbonamento attivo o in cancellazione"),
						past_due: count("Rinnovo fallito"),
						suspended: count("Abbonamento sospeso"),
						none: count("Senza abbonamento o con abbonamento cancellato"),
						deleted: count("Negozi eliminati"),
					}),
				),
			}),
			detail: {
				summary: "Contatori negozi per tab",
				description:
					"Numero di negozi per ogni tab della lista admin, con gli stessi criteri di GET /admin/stores.",
				tags: ["Admin"],
			},
		},
	)
	.get(
		"/stores",
		async ({ query }) => {
			const result = await listStores(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: StoreListQuery,
			response: withErrors({ 200: okPageRes(AdminStoreListItemSchema) }),
			detail: {
				summary: "Lista negozi",
				description:
					"Lista paginata di tutti i negozi della piattaforma con venditore, categoria, comune e stato dell'abbonamento. Filtrabile per tab (status), ricerca testuale e ordinamento. Senza status mostra solo i negozi non eliminati.",
				tags: ["Admin"],
			},
		},
	);
```

In `apps/api/src/modules/admin/index.ts`: `import { storesRoutes } from "./routes/stores";` e `.use(storesRoutes)` subito dopo `.use(sellersRoutes)`.

- [ ] **Step 2: Typecheck dalla root (Eden nei tre FE)**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: OpenAPI**

Con l'API in dev su `:3000`:
Run: `curl -s localhost:3000/openapi/json | jq '.paths | keys | map(select(startswith("/admin/stores")))'`
Expected: `["/admin/stores", "/admin/stores/counts"]`. (Se il path JSON differisce, prendilo da `apps/api/src` cercando `openapi(`.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/admin/routes/stores.ts apps/api/src/modules/admin/index.ts
git commit -m "feat(api): GET /admin/stores e /admin/stores/counts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Pagina Admin → Negozi

**Files:**
- Modify: `apps/admin/src/routes/_authenticated/stores.tsx` (riscrittura)
- Modify: `apps/admin/messages/it.json`, `apps/admin/messages/en.json`

**Interfaces:**
- Consumes: Eden da Task 9; `PageHeader`, `SearchInput`, `DataTableFooter`, `TabNav`, `DataTable`, `SortableHeader`, `TableColumnsToggle`, `EmptyState`, `subscriptionStatusBadge`, `formatDate` (`@bibs/ui/lib/date`), `parsePaginationSearch` (`@bibs/ui/lib/pagination-search`).

- [ ] **Step 1: Messaggi**

`apps/admin/messages/it.json`: rinomina `placeholder_stores_description` in `stores_description` (stesso testo) e aggiungi accanto:

```json
	"stores_description": "Gestisci i negozi della piattaforma",
	"stores_tabs_label": "Stato dei negozi",
	"stores_tab_all": "Tutti",
	"stores_tab_active": "Attivi",
	"stores_tab_past_due": "Rinnovo fallito",
	"stores_tab_suspended": "Sospesi",
	"stores_tab_none": "Senza abbonamento",
	"stores_tab_deleted": "Eliminati",
	"stores_search_placeholder": "Cerca per negozio, venditore o comune...",
	"stores_search_label": "Cerca negozi",
	"stores_column_store": "Negozio",
	"stores_column_seller": "Venditore",
	"stores_column_category": "Categoria",
	"stores_column_municipality": "Comune",
	"stores_column_subscription": "Abbonamento",
	"stores_column_created_at": "Creato il",
	"stores_column_deleted_at": "Eliminato il",
	"stores_empty_title": "Nessun negozio",
	"stores_empty_description": "I negozi aperti dai venditori appariranno qui.",
	"stores_empty_tab_description": "Nessun negozio in questo stato.",
	"stores_no_results_description": "Nessun negozio corrisponde a \"{query}\".",
	"stores_load_error": "Errore nel caricamento dei negozi",
	"stores_pagination_range": "{start}–{end} di {total} negozi",
	"stores_pagination_range_one": "{start}–{end} di {total} negozio",
```

`apps/admin/messages/en.json` (stesse chiavi, rinomina anche lì `placeholder_stores_description`):

```json
	"stores_description": "Manage the platform's stores",
	"stores_tabs_label": "Store status",
	"stores_tab_all": "All",
	"stores_tab_active": "Active",
	"stores_tab_past_due": "Renewal failed",
	"stores_tab_suspended": "Suspended",
	"stores_tab_none": "No subscription",
	"stores_tab_deleted": "Deleted",
	"stores_search_placeholder": "Search by store, seller or town...",
	"stores_search_label": "Search stores",
	"stores_column_store": "Store",
	"stores_column_seller": "Seller",
	"stores_column_category": "Category",
	"stores_column_municipality": "Town",
	"stores_column_subscription": "Subscription",
	"stores_column_created_at": "Created",
	"stores_column_deleted_at": "Deleted",
	"stores_empty_title": "No stores",
	"stores_empty_description": "Stores opened by sellers will appear here.",
	"stores_empty_tab_description": "No stores with this status.",
	"stores_no_results_description": "No store matches \"{query}\".",
	"stores_load_error": "Error loading stores",
	"stores_pagination_range": "{start}–{end} of {total} stores",
	"stores_pagination_range_one": "{start}–{end} of {total} store",
```

Run: `grep -rn "placeholder_stores_description" apps/admin/src | grep -v paraglide`
Expected: solo `stores.tsx` (riscritto allo Step 2).

- [ ] **Step 2: Pagina**

`apps/admin/src/routes/_authenticated/stores.tsx`:

```tsx
import { Badge } from "@bibs/ui/components/badge";
import { DataTable, SortableHeader } from "@bibs/ui/custom/data-table";
import { DataTableFooter } from "@bibs/ui/custom/data-table-footer";
import { EmptyState } from "@bibs/ui/custom/empty-state";
import { PageHeader } from "@bibs/ui/custom/page-header";
import { SearchInput } from "@bibs/ui/custom/search-input";
import { TabNav, type TabNavItem } from "@bibs/ui/custom/tab-nav";
import { TableColumnsToggle } from "@bibs/ui/custom/table-columns-toggle";
import { formatDate } from "@bibs/ui/lib/date";
import { parsePaginationSearch } from "@bibs/ui/lib/pagination-search";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { subscriptionStatusBadge } from "@/features/billing/subscription-status";
import { api } from "@/lib/api";
import {
	dataTableFooterLabels,
	tableColumnsToggleLabels,
} from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

const STATUSES = [
	"all",
	"active",
	"past_due",
	"suspended",
	"none",
	"deleted",
] as const;
type StoreStatus = (typeof STATUSES)[number];
type SortField = "name" | "createdAt";
type SortDir = "asc" | "desc";

const TABS: {
	value: StoreStatus;
	label: () => string;
	badgeColor: TabNavItem["badgeColor"];
}[] = [
	{ value: "all", label: m.stores_tab_all, badgeColor: "default" },
	{ value: "active", label: m.stores_tab_active, badgeColor: "success" },
	{ value: "past_due", label: m.stores_tab_past_due, badgeColor: "warning" },
	{ value: "suspended", label: m.stores_tab_suspended, badgeColor: "destructive" },
	{ value: "none", label: m.stores_tab_none, badgeColor: "default" },
	{ value: "deleted", label: m.stores_tab_deleted, badgeColor: "default" },
];

export const Route = createFileRoute("/_authenticated/stores")({
	component: StoresPage,
	validateSearch: (
		search: Record<string, unknown>,
	): {
		page: number;
		limit: number;
		status?: StoreStatus;
		q?: string;
		sort?: SortField;
		order?: SortDir;
	} => {
		const status = STATUSES.includes(search.status as StoreStatus)
			? (search.status as StoreStatus)
			: undefined;
		const q = typeof search.q === "string" && search.q.length > 0 ? search.q : undefined;
		const sort =
			search.sort === "name" || search.sort === "createdAt"
				? (search.sort as SortField)
				: undefined;
		const order =
			search.order === "asc" || search.order === "desc"
				? (search.order as SortDir)
				: undefined;
		return {
			...parsePaginationSearch(search),
			...(status && status !== "all" ? { status } : {}),
			...(q ? { q } : {}),
			...(sort && order ? { sort, order } : {}),
		};
	},
});

function StoresPage() {
	"use no memo";

	const { page, limit, status = "all", q = "", sort, order } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	const { data: counts } = useQuery({
		queryKey: ["admin-stores-counts"],
		queryFn: async () => {
			const res = await api().admin.stores.counts.get();
			return res.error ? null : (res.data?.data ?? null);
		},
	});

	const { data, isLoading, error } = useQuery({
		queryKey: ["admin-stores", status, page, limit, q, sort, order],
		queryFn: async () => {
			const res = await api().admin.stores.get({
				query: {
					page,
					limit,
					status,
					...(q ? { search: q } : {}),
					sortBy: sort ?? "createdAt",
					sortOrder: order ?? "desc",
				},
			});
			if (res.error)
				throw new Error(res.error.value?.message || m.stores_load_error());
			return res.data;
		},
	});

	type Row = NonNullable<typeof data>["data"][number];
	const rows = data?.data ?? [];

	const sorting: SortingState = sort ? [{ id: sort, desc: order === "desc" }] : [];
	const onSortingChange = (next: SortingState) => {
		const head = next[0];
		void navigate({
			search: (prev) => ({
				...prev,
				sort: head ? (head.id as SortField) : undefined,
				order: head ? (head.desc ? "desc" : "asc") : undefined,
				page: 1,
			}),
		});
	};

	const tabs: TabNavItem[] = TABS.map((tab) => ({
		value: tab.value,
		label: tab.label(),
		badgeColor: tab.badgeColor,
		count: counts ? counts[tab.value] : null,
	}));

	const sellerLink = (row: Row, children: ReactNode) => (
		<Link
			to="/sellers/$sellerId"
			params={{ sellerId: row.sellerProfileId }}
			className="hover:text-primary hover:underline"
		>
			{children}
		</Link>
	);
	const dash = <span className="text-muted-foreground">—</span>;

	const columns: DataTableColumnDef<Row>[] = [
		{
			id: "name",
			accessorKey: "name",
			enableHiding: false,
			enableSorting: true,
			meta: { menuLabel: m.stores_column_store(), cellClassName: "font-semibold" },
			header: ({ column }) => (
				<SortableHeader column={column}>{m.stores_column_store()}</SortableHeader>
			),
			cell: ({ row }) => sellerLink(row.original, row.original.name),
		},
		{
			id: "seller",
			header: m.stores_column_seller(),
			meta: { menuLabel: m.stores_column_seller(), cellClassName: "text-sm" },
			cell: ({ row }) =>
				row.original.businessName
					? sellerLink(row.original, row.original.businessName)
					: dash,
		},
		{
			id: "category",
			header: m.stores_column_category(),
			meta: { menuLabel: m.stores_column_category(), cellClassName: "text-sm" },
			cell: ({ row }) => row.original.categoryName ?? dash,
		},
		{
			id: "municipality",
			header: m.stores_column_municipality(),
			meta: { menuLabel: m.stores_column_municipality(), cellClassName: "text-sm" },
			cell: ({ row }) =>
				`${row.original.municipality.name} (${row.original.municipality.provinceAcronym})`,
		},
		{
			id: "subscription",
			header: m.stores_column_subscription(),
			meta: { menuLabel: m.stores_column_subscription() },
			cell: ({ row }) => {
				if (!row.original.subscriptionStatus) return dash;
				const badge = subscriptionStatusBadge(row.original.subscriptionStatus);
				return <Badge variant={badge.variant}>{badge.label}</Badge>;
			},
		},
		{
			id: "createdAt",
			accessorKey: "createdAt",
			enableSorting: true,
			meta: {
				menuLabel: m.stores_column_created_at(),
				cellClassName: "text-muted-foreground text-sm",
			},
			header: ({ column }) => (
				<SortableHeader column={column}>
					{m.stores_column_created_at()}
				</SortableHeader>
			),
			cell: ({ row }) => formatDate(row.original.createdAt, { long: true }),
		},
		...(status === "deleted"
			? [
					{
						id: "deletedAt",
						header: m.stores_column_deleted_at(),
						meta: {
							menuLabel: m.stores_column_deleted_at(),
							cellClassName: "text-muted-foreground text-sm",
						},
						cell: ({ row }) =>
							row.original.deletedAt
								? formatDate(row.original.deletedAt, { long: true })
								: dash,
					} satisfies DataTableColumnDef<Row>,
				]
			: []),
		{
			id: "toggle",
			enableHiding: false,
			meta: { headerClassName: "w-12 text-right" },
			header: ({ table }) => (
				<TableColumnsToggle
					table={table}
					labels={tableColumnsToggleLabels()}
					align="end"
				/>
			),
			cell: () => null,
		},
	];

	return (
		<div className="space-y-4">
			<PageHeader title={m.common_stores()} description={m.stores_description()} />

			<TabNav
				tabs={tabs}
				activeTab={status}
				onTabChange={(value) =>
					void navigate({
						search: (prev) => ({
							...prev,
							status: value === "all" ? undefined : (value as StoreStatus),
							page: 1,
						}),
					})
				}
				label={m.stores_tabs_label()}
			/>

			<SearchInput
				value={q}
				onValueChange={(next) =>
					void navigate({
						search: (prev) => ({
							...prev,
							q: next.length > 0 ? next : undefined,
							page: 1,
						}),
					})
				}
				placeholder={m.stores_search_placeholder()}
				aria-label={m.stores_search_label()}
				clearLabel={m.common_clear_search()}
				className="max-w-md"
			/>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						{m.common_load_error_with_message({
							message: (error as Error).message,
						})}
					</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="admin.stores.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				manualSorting={{ sorting, onSortingChange }}
				hideHeaderWhenEmpty={q.length === 0}
				emptyState={
					q.length > 0 ? (
						<EmptyState
							variant="no-results"
							title={m.common_no_results()}
							description={m.stores_no_results_description({ query: q })}
						/>
					) : (
						<EmptyState
							title={m.stores_empty_title()}
							description={
								status === "all"
									? m.stores_empty_description()
									: m.stores_empty_tab_description()
							}
						/>
					)
				}
			/>

			<DataTableFooter
				page={page}
				pageSize={limit}
				total={data?.pagination.total ?? 0}
				rangeLabel={(r) =>
					(r.total === 1
						? m.stores_pagination_range_one
						: m.stores_pagination_range)(r)
				}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) =>
					void navigate({ search: (prev) => ({ ...prev, limit: size, page: 1 }) })
				}
				onPageChange={(next, options) =>
					void navigate({
						search: (prev) => ({ ...prev, page: next }),
						replace: options?.replace,
					})
				}
			/>
		</div>
	);
}
```

- [ ] **Step 3: Typecheck, lint, test**

Run: `bun run typecheck && bun run lint && bun run --filter @bibs/admin test`
Expected: exit 0. Rigenera e committa `routeTree.gen.ts` se cambia.

- [ ] **Step 4: Browser**

Seed Bologna. `/stores` (sessione admin): conteggi nelle tab = righe per tab (scorri il totale nel piede); ogni tab; ricerca per comune («Bologna»), per venditore, per nome; `?q=` + Indietro; link negozio e venditore → `/sellers/$sellerId`; ordinamento Negozio/Creato il; colonna «Eliminato il» solo in Eliminati; vuoto («Nessun negozio in questo stato.» in una tab vuota); `?page=99` torna all'ultima pagina; dark mode. Screenshot e aprili.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/routes/_authenticated/stores.tsx apps/admin/messages/it.json apps/admin/messages/en.json apps/admin/src/routeTree.gen.ts
git commit -m "feat(admin): lista di tutti i negozi con tab per stato abbonamento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Chiusura PR 2

- [ ] **Step 1: Verifica completa**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: exit 0 per ogni workspace.

- [ ] **Step 2: Smoke di Marco** su `/stores`, mouse e tastiera. Aspetta l'ok.

- [ ] **Step 3: PR** con `superpowers:finishing-a-development-branch` e `/commit-commands:commit-push-pr`. Titolo: `feat(admin): lista negozi`. Body: endpoint, tab e semantica (`active` include `canceling`; `none` include `canceled`), pagina, verifica. Chiudi con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
