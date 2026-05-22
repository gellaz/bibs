# Seller Products Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere filtro per **prezzo** (min/max) e **categoria** (single-select foglia) alla lista prodotti seller `/products`, e impostare `updatedAt DESC` come sort di default lato backend.

**Architecture:** Il backend `GET /seller/products` accetta già tutti i query params (`productCategoryId`, `minPrice`, `maxPrice`); cambia solo il default di sort nel service `listProducts`. Il frontend introduce due nuovi componenti (`ProductsFilterBar` con chip + `ProductsFilterPopover` con i controlli) e estende l'URL state della route.

**Tech Stack:** Elysia + Drizzle (backend), TanStack Router/Query + shadcn/ui (frontend), bun:test (integration test).

**Spec:** `docs/superpowers/specs/2026-05-22-seller-products-filters-design.md`

**Branch:** `feat/seller-products-filters` (già creato; lo spec è già committato).

---

## File structure

**Backend**
- Modify: `apps/api/src/modules/seller/services/products.ts` — cambia il `default:` del `switch(sort)` per ordinare per `updatedAt`.
- Modify: `apps/api/tests/integration/seller-products-filters.test.ts` — aggiunge un `describe("default sort", …)` con due test.

**Frontend**
- Create: `apps/seller/src/features/products/components/products-filter-popover.tsx` — popover con dropdown categoria + due input prezzo.
- Create: `apps/seller/src/features/products/components/products-filter-bar.tsx` — pulsante trigger + chip rimovibili.
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx` — `validateSearch` esteso, useQuery aggiornato, monta `ProductsFilterBar`, colonna `updatedAt` visibile di default.

---

## Task 1: Backend — failing test per default sort = updatedAt

**Files:**
- Modify: `apps/api/tests/integration/seller-products-filters.test.ts`

- [ ] **Step 1: Aggiungere il describe in fondo al file**

Aprire il file e aggiungere alla fine (dopo l'ultimo `});` del describe `sort by stock`):

```ts
describe("default sort", () => {
	it("senza sort esplicito, ordina per updatedAt decrescente", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		// Creiamo tre prodotti, poi modifichiamo p2 per ultimo così p2 deve apparire in testa.
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		const p3 = await createTestProduct(db, seller.profile.id, { name: "P3" });

		// Bump updatedAt di p2: l'ordine richiesto è p2 (più recente), poi p3, poi p1.
		// Forziamo timestamps espliciti per evitare flakiness su clock resolution.
		await db
			.update(product)
			.set({ updatedAt: new Date("2026-01-01T10:00:00Z") })
			.where(eq(product.id, p1.id));
		await db
			.update(product)
			.set({ updatedAt: new Date("2026-01-01T10:00:02Z") })
			.where(eq(product.id, p3.id));
		await db
			.update(product)
			.set({ updatedAt: new Date("2026-01-01T10:00:05Z") })
			.where(eq(product.id, p2.id));

		const out = await listProducts({ sellerProfileId: seller.profile.id });
		expect(out.data.map((p) => p.name)).toEqual(["P2", "P3", "P1"]);
	});

	it("a parità di updatedAt, tiebreak su createdAt decrescente", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });

		const sameUpdatedAt = new Date("2026-01-01T10:00:00Z");
		await db
			.update(product)
			.set({
				updatedAt: sameUpdatedAt,
				createdAt: new Date("2026-01-01T08:00:00Z"),
			})
			.where(eq(product.id, p1.id));
		await db
			.update(product)
			.set({
				updatedAt: sameUpdatedAt,
				createdAt: new Date("2026-01-01T09:00:00Z"),
			})
			.where(eq(product.id, p2.id));

		const out = await listProducts({ sellerProfileId: seller.profile.id });
		expect(out.data.map((p) => p.name)).toEqual(["P2", "P1"]);
	});
});
```

- [ ] **Step 2: Aggiungere gli import mancanti in cima al file**

In cima al file dopo gli import esistenti, aggiungere (o estendere se la riga `from "drizzle-orm"` esiste già):

```ts
import { eq } from "drizzle-orm";
import { product } from "@/db/schemas/product";
```

Verifica con grep che non siano già importati (probabilmente non lo sono — il file usa solo helper fixtures finora).

- [ ] **Step 3: Eseguire i nuovi test per verificare che falliscano**

Run:

```bash
bun test apps/api/tests/integration/seller-products-filters.test.ts -t "default sort"
```

Expected: entrambi i test FAIL. Il primo fallisce perché l'ordine attuale è basato su `createdAt DESC` → in testa ci sarà `P3` (creato per ultimo), non `P2`. Il secondo fallisce per ragioni simili.

- [ ] **Step 4: Non committare ancora — l'implementazione segue nel Task 2.**

---

## Task 2: Backend — cambio default sort in listProducts

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts:232-233`

- [ ] **Step 1: Cambiare il branch default del switch sort**

Apri `apps/api/src/modules/seller/services/products.ts` e localizza il `switch (sort)` (intorno a riga 211). Il branch `default` attuale è:

```ts
default:
    return [desc(product.createdAt)];
```

Sostituiscilo con:

```ts
default:
    return [desc(product.updatedAt), desc(product.createdAt)];
```

Nessun altro cambio nel file.

- [ ] **Step 2: Eseguire i test per verificare che passino**

Run:

```bash
bun test apps/api/tests/integration/seller-products-filters.test.ts -t "default sort"
```

Expected: entrambi PASS.

- [ ] **Step 3: Eseguire l'intera suite del file per assicurarsi di non aver rotto nulla**

Run:

```bash
bun test apps/api/tests/integration/seller-products-filters.test.ts
```

Expected: tutti i test PASS (nuovi + esistenti).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts apps/api/tests/integration/seller-products-filters.test.ts
git commit -m "$(cat <<'EOF'
feat(api): default sort prodotti per updatedAt DESC

Il default di listProducts passa da createdAt DESC a updatedAt DESC con
createdAt come tiebreaker stabile. Cosi' i prodotti modificati di recente
appaiono in testa nella lista seller. Nessun cambio al contratto API
(sort esplicito continua a vincere).
EOF
)"
```

---

## Task 3: Frontend — ProductsFilterPopover (componente)

**Files:**
- Create: `apps/seller/src/features/products/components/products-filter-popover.tsx`

- [ ] **Step 1: Creare il file con il componente completo**

```tsx
import { Button } from "@bibs/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@bibs/ui/components/command";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@bibs/ui/components/popover";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, FilterIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";

// ── Helpers ─────────────────────────────────────────────────────────────────
// Converte input utente (it: "5,00") in canonical decimal ("5.00") accettato
// dal backend. Ritorna undefined se la stringa pulita non matcha il pattern.
function normalizePrice(raw: string): string | undefined {
	const trimmed = raw.trim().replace(",", ".");
	if (trimmed.length === 0) return undefined;
	if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
	return trimmed;
}

interface FilterValue {
	categoryId?: string;
	minPrice?: string;
	maxPrice?: string;
}

interface ProductsFilterPopoverProps {
	value: FilterValue;
	onChange: (next: FilterValue) => void;
	trigger: ReactNode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ProductsFilterPopover({
	value,
	onChange,
	trigger,
	open,
	onOpenChange,
}: ProductsFilterPopoverProps) {
	// Stato locale per i due input prezzo. Debounced 300ms come la search.
	const [localMin, setLocalMin] = useState(value.minPrice ?? "");
	const [localMax, setLocalMax] = useState(value.maxPrice ?? "");
	const debouncedMin = useDebouncedValue(localMin, 300);
	const debouncedMax = useDebouncedValue(localMax, 300);

	// Sync con URL quando l'esterno cambia (back/forward del browser).
	useEffect(() => {
		setLocalMin(value.minPrice ?? "");
	}, [value.minPrice]);
	useEffect(() => {
		setLocalMax(value.maxPrice ?? "");
	}, [value.maxPrice]);

	// Push verso onChange quando il debounced cambia rispetto al valore corrente in URL.
	useEffect(() => {
		const normalized = normalizePrice(debouncedMin);
		if (normalized === value.minPrice) return;
		onChange({ ...value, minPrice: normalized });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debouncedMin]);
	useEffect(() => {
		const normalized = normalizePrice(debouncedMax);
		if (normalized === value.maxPrice) return;
		onChange({ ...value, maxPrice: normalized });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debouncedMax]);

	// Categorie + macro: una sola query, dataset modesto (max 200).
	const { data: categories = [] } = useQuery({
		queryKey: ["product-categories", "filter-all"],
		queryFn: async () => {
			const response = await api()["product-categories"].get({
				query: { page: 1, limit: 200 },
			});
			if (response.error) throw new Error("Errore caricamento categorie");
			return response.data.data;
		},
	});

	type Category = (typeof categories)[number];

	// Raggruppa per macro mantenendo ordine alfabetico macro / categoria.
	const grouped = useMemo(() => {
		const map = new Map<string, { macroName: string; items: Category[] }>();
		for (const c of categories) {
			const mid = c.macroCategory.id;
			const entry = map.get(mid);
			if (entry) {
				entry.items.push(c);
			} else {
				map.set(mid, { macroName: c.macroCategory.name, items: [c] });
			}
		}
		const arr = Array.from(map.values());
		arr.sort((a, b) => a.macroName.localeCompare(b.macroName, "it"));
		for (const g of arr) {
			g.items.sort((a, b) => a.name.localeCompare(b.name, "it"));
		}
		return arr;
	}, [categories]);

	// Validation hint inline su min/max.
	const priceHint = (() => {
		const minN = normalizePrice(localMin);
		const maxN = normalizePrice(localMax);
		if (!minN || !maxN) return null;
		if (parseFloat(minN) > parseFloat(maxN)) return "Min superiore a max";
		return null;
	})();

	const handleReset = () => {
		setLocalMin("");
		setLocalMax("");
		onChange({});
	};

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				className="w-80 p-0"
				align="start"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<div className="space-y-4 p-4">
					<div className="space-y-2">
						<Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Categoria
						</Label>
						<Command className="border rounded-md">
							<CommandInput placeholder="Cerca categoria…" />
							<CommandList className="max-h-56">
								<CommandEmpty>Nessuna categoria.</CommandEmpty>
								<CommandGroup>
									<CommandItem
										value="__all__"
										onSelect={() =>
											onChange({ ...value, categoryId: undefined })
										}
									>
										<div className="flex w-4 items-center">
											{!value.categoryId && <CheckIcon className="size-4" />}
										</div>
										Tutte le categorie
									</CommandItem>
								</CommandGroup>
								{grouped.map((g) => (
									<CommandGroup key={g.macroName} heading={g.macroName}>
										{g.items.map((c) => {
											const isOn = value.categoryId === c.id;
											return (
												<CommandItem
													key={c.id}
													value={`${c.name} ${g.macroName}`}
													onSelect={() =>
														onChange({ ...value, categoryId: c.id })
													}
												>
													<div className="flex w-4 items-center">
														{isOn && <CheckIcon className="size-4" />}
													</div>
													{c.name}
												</CommandItem>
											);
										})}
									</CommandGroup>
								))}
							</CommandList>
						</Command>
					</div>

					<div className="space-y-2">
						<Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Prezzo
						</Label>
						<div className="grid grid-cols-2 gap-2">
							<div className="space-y-1">
								<Label htmlFor="filter-min-price" className="text-xs">
									Min
								</Label>
								<div className="relative">
									<Input
										id="filter-min-price"
										inputMode="decimal"
										placeholder="0,00"
										value={localMin}
										onChange={(e) => setLocalMin(e.target.value)}
										className="pr-7"
									/>
									<span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
										€
									</span>
								</div>
							</div>
							<div className="space-y-1">
								<Label htmlFor="filter-max-price" className="text-xs">
									Max
								</Label>
								<div className="relative">
									<Input
										id="filter-max-price"
										inputMode="decimal"
										placeholder="0,00"
										value={localMax}
										onChange={(e) => setLocalMax(e.target.value)}
										className="pr-7"
									/>
									<span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
										€
									</span>
								</div>
							</div>
						</div>
						{priceHint && (
							<p className="text-xs text-destructive">{priceHint}</p>
						)}
					</div>

					<div className="flex justify-end border-t pt-3">
						<Button variant="ghost" size="sm" onClick={handleReset}>
							Reset
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

// Anche se non usato dal popover stesso, esponiamo `FilterIcon` per il bar.
export { FilterIcon };
```

- [ ] **Step 2: Type-check rapido del nuovo file**

Run:

```bash
bun run --filter @bibs/seller typecheck
```

Expected: zero errori riferiti a `products-filter-popover.tsx`.

- [ ] **Step 3: Non committare ancora — Task 4 aggiunge il bar che lo consuma.**

---

## Task 4: Frontend — ProductsFilterBar (bar + chip)

**Files:**
- Create: `apps/seller/src/features/products/components/products-filter-bar.tsx`

- [ ] **Step 1: Creare il file completo**

```tsx
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { FilterIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { ProductsFilterPopover } from "./products-filter-popover";

interface FilterValue {
	categoryId?: string;
	minPrice?: string;
	maxPrice?: string;
}

interface ProductsFilterBarProps {
	value: FilterValue;
	onChange: (next: FilterValue) => void;
}

// Formatta una stringa decimale canonical ("5.00") in display IT ("5,00 €").
function formatPriceIt(decimal: string): string {
	const n = Number.parseFloat(decimal);
	if (Number.isNaN(n)) return decimal;
	return `${n.toLocaleString("it-IT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})} €`;
}

function priceChipLabel(min?: string, max?: string): string {
	if (min && max) return `${formatPriceIt(min)} – ${formatPriceIt(max)}`;
	if (min) return `≥ ${formatPriceIt(min)}`;
	if (max) return `≤ ${formatPriceIt(max)}`;
	return "";
}

export function ProductsFilterBar({ value, onChange }: ProductsFilterBarProps) {
	const [open, setOpen] = useState(false);

	const activeCount =
		(value.categoryId ? 1 : 0) +
		(value.minPrice ? 1 : 0) +
		(value.maxPrice ? 1 : 0);

	// Resolve categoryId → name. Cache condivisa con il popover.
	const { data: categories } = useQuery({
		queryKey: ["product-categories", "filter-all"],
		queryFn: async () => {
			const response = await api()["product-categories"].get({
				query: { page: 1, limit: 200 },
			});
			if (response.error) throw new Error("Errore caricamento categorie");
			return response.data.data;
		},
		enabled: Boolean(value.categoryId),
	});

	const categoryName = useMemo(() => {
		if (!value.categoryId || !categories) return null;
		return categories.find((c) => c.id === value.categoryId)?.name ?? null;
	}, [value.categoryId, categories]);

	const hasPriceFilter = Boolean(value.minPrice || value.maxPrice);

	return (
		<div className="space-y-2">
			<ProductsFilterPopover
				value={value}
				onChange={onChange}
				open={open}
				onOpenChange={setOpen}
				trigger={
					<Button variant="outline" size="sm" className="gap-2">
						<FilterIcon className="size-4" />
						Filtri
						{activeCount > 0 && (
							<Badge variant="secondary" className="ml-1">
								{activeCount}
							</Badge>
						)}
					</Button>
				}
			/>

			{activeCount > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{value.categoryId && (
						<Badge variant="secondary" className="gap-1 pr-1">
							<span>
								Categoria:{" "}
								<span className="font-medium">{categoryName ?? "…"}</span>
							</span>
							<button
								type="button"
								aria-label="Rimuovi filtro categoria"
								className="hover:bg-foreground/10 -mr-0.5 flex size-4 items-center justify-center rounded-full"
								onClick={() => onChange({ ...value, categoryId: undefined })}
							>
								<XIcon className="size-3" />
							</button>
						</Badge>
					)}
					{hasPriceFilter && (
						<Badge variant="secondary" className="gap-1 pr-1">
							<span>
								Prezzo:{" "}
								<span className="font-medium">
									{priceChipLabel(value.minPrice, value.maxPrice)}
								</span>
							</span>
							<button
								type="button"
								aria-label="Rimuovi filtro prezzo"
								className="hover:bg-foreground/10 -mr-0.5 flex size-4 items-center justify-center rounded-full"
								onClick={() =>
									onChange({
										...value,
										minPrice: undefined,
										maxPrice: undefined,
									})
								}
							>
								<XIcon className="size-3" />
							</button>
						</Badge>
					)}
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
bun run --filter @bibs/seller typecheck
```

Expected: zero errori sui due nuovi file.

- [ ] **Step 3: Non committare ancora — Task 5 li integra nella route.**

---

## Task 5: Frontend — Integrazione nella route products

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx`

- [ ] **Step 1: Aggiungere import del nuovo bar**

In testa al file, vicino agli altri import di `@/features/products/components/...`, aggiungere:

```tsx
import { ProductsFilterBar } from "@/features/products/components/products-filter-bar";
```

- [ ] **Step 2: Estendere `validateSearch` con i 3 nuovi campi**

Trovare il blocco `validateSearch: (search: …): { … }` (intorno alla riga 53). Sostituire il return type e il body in modo da includere `categoryId`, `minPrice`, `maxPrice`. La forma attuale:

```ts
validateSearch: (
    search: Record<string, unknown>,
): {
    page: number;
    limit: number;
    statusFilter: ProductStatusFilter;
    q?: string;
    sort?: ProductSortField;
    order?: SortOrder;
} => {
    const sf = search.statusFilter;
    const statusFilter: ProductStatusFilter =
        sf === "disabled" || sf === "trashed" ? sf : "active";
    const rawQ = typeof search.q === "string" ? search.q : "";
    const sort = SORT_FIELDS.includes(search.sort as ProductSortField)
        ? (search.sort as ProductSortField)
        : undefined;
    const order =
        search.order === "asc" || search.order === "desc"
            ? (search.order as SortOrder)
            : undefined;
    return {
        page: Number(search.page ?? 1),
        limit: Number(search.limit ?? 20),
        statusFilter,
        ...(rawQ.length > 0 ? { q: rawQ } : {}),
        ...(sort && order ? { sort, order } : {}),
    };
},
```

Diventa:

```ts
validateSearch: (
    search: Record<string, unknown>,
): {
    page: number;
    limit: number;
    statusFilter: ProductStatusFilter;
    q?: string;
    sort?: ProductSortField;
    order?: SortOrder;
    categoryId?: string;
    minPrice?: string;
    maxPrice?: string;
} => {
    const sf = search.statusFilter;
    const statusFilter: ProductStatusFilter =
        sf === "disabled" || sf === "trashed" ? sf : "active";
    const rawQ = typeof search.q === "string" ? search.q : "";
    const sort = SORT_FIELDS.includes(search.sort as ProductSortField)
        ? (search.sort as ProductSortField)
        : undefined;
    const order =
        search.order === "asc" || search.order === "desc"
            ? (search.order as SortOrder)
            : undefined;
    const categoryId =
        typeof search.categoryId === "string" && search.categoryId.length > 0
            ? search.categoryId
            : undefined;
    const PRICE_RE = /^\d+(\.\d{1,2})?$/;
    const minPrice =
        typeof search.minPrice === "string" && PRICE_RE.test(search.minPrice)
            ? search.minPrice
            : undefined;
    const maxPrice =
        typeof search.maxPrice === "string" && PRICE_RE.test(search.maxPrice)
            ? search.maxPrice
            : undefined;
    return {
        page: Number(search.page ?? 1),
        limit: Number(search.limit ?? 20),
        statusFilter,
        ...(rawQ.length > 0 ? { q: rawQ } : {}),
        ...(sort && order ? { sort, order } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(minPrice ? { minPrice } : {}),
        ...(maxPrice ? { maxPrice } : {}),
    };
},
```

- [ ] **Step 3: Estendere il destructure di `useSearch` e il `queryKey`**

All'inizio di `ProductsListPage` la riga:

```ts
const {
    page,
    limit,
    statusFilter,
    q: routeQ,
    sort,
    order,
} = Route.useSearch();
```

Diventa:

```ts
const {
    page,
    limit,
    statusFilter,
    q: routeQ,
    sort,
    order,
    categoryId,
    minPrice,
    maxPrice,
} = Route.useSearch();
```

Poi nel `useQuery`, estendere il `queryKey` e la `queryFn`:

```ts
const { data, isLoading, error } = useQuery({
    queryKey: [
        "products",
        activeStore?.id,
        page,
        limit,
        statusFilter,
        effectiveRouteQ,
        sort,
        order,
        categoryId,
        minPrice,
        maxPrice,
    ],
    queryFn: async () => {
        const storeId = activeStore?.id;
        if (!storeId) throw new Error("No active store");
        const response = await api().seller.products.get({
            query: {
                storeId,
                page,
                limit,
                statusFilter,
                q: effectiveRouteQ.length > 0 ? effectiveRouteQ : undefined,
                ...(sort && order ? { sort, order } : {}),
                ...(categoryId ? { productCategoryId: categoryId } : {}),
                ...(minPrice ? { minPrice } : {}),
                ...(maxPrice ? { maxPrice } : {}),
            },
        });
        if (response.error) {
            throw new Error(response.error.value?.message || "Errore caricamento");
        }
        return response.data;
    },
    enabled: !!activeStore?.id,
});
```

(Cambio chiave: `categoryId` lato FE → `productCategoryId` lato API.)

- [ ] **Step 4: Cambiare `INITIAL_COLUMN_VISIBILITY` per mostrare `updatedAt` di default**

Trovare la costante:

```ts
const INITIAL_COLUMN_VISIBILITY = {
    brand: false,
    ean: false,
    updatedAt: false,
};
```

Sostituire con:

```ts
const INITIAL_COLUMN_VISIBILITY = {
    brand: false,
    ean: false,
};
```

(rimossa la riga `updatedAt: false` → la colonna è visibile di default; resta nascondibile via `TableColumnsToggle`).

- [ ] **Step 5: Montare `<ProductsFilterBar />` nella view, dopo la search e prima dei `ProductStatusTabs`**

Trovare il blocco `{activeStore && (…)}` che contiene `<InputGroup>` (search) seguito da `<ProductStatusTabs />`. La struttura attuale è:

```tsx
{activeStore && (
    <div className="space-y-3">
        <InputGroup className="max-w-md">
            {/* … search … */}
        </InputGroup>
        <ProductStatusTabs
            storeId={activeStore.id}
            value={statusFilter}
            onChange={goToTab}
        />
    </div>
)}
```

Diventa:

```tsx
{activeStore && (
    <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
            <InputGroup className="max-w-md flex-1 min-w-[240px]">
                {/* … search invariata … */}
            </InputGroup>
            <ProductsFilterBar
                value={{ categoryId, minPrice, maxPrice }}
                onChange={(next) =>
                    void navigate({
                        search: (prev) => ({
                            ...prev,
                            categoryId: next.categoryId,
                            minPrice: next.minPrice,
                            maxPrice: next.maxPrice,
                            page: 1,
                        }),
                    })
                }
            />
        </div>
        <ProductStatusTabs
            storeId={activeStore.id}
            value={statusFilter}
            onChange={goToTab}
        />
    </div>
)}
```

Nota: search e bar adesso vivono in una flex row così il bar appare a destra della search su schermo wide e va sotto su mobile.

- [ ] **Step 6: Type-check**

Run:

```bash
bun run --filter @bibs/seller typecheck
```

Expected: zero errori. In particolare verificare:
- `Route.useSearch()` ritorna il tipo esteso.
- `api().seller.products.get` accetta `productCategoryId`, `minPrice`, `maxPrice` (lo accetta già — Eden Treaty deriva dalla TypeBox schema esistente).

- [ ] **Step 7: Commit della parte frontend**

```bash
git add apps/seller/src/features/products/components/products-filter-popover.tsx \
        apps/seller/src/features/products/components/products-filter-bar.tsx \
        apps/seller/src/routes/_authenticated/products/index.tsx
git commit -m "$(cat <<'EOF'
feat(seller): filtri prezzo e categoria sulla lista prodotti

Aggiunge un popover Filtri accanto alla search con dropdown searchable
sulla categoria foglia (raggruppata per macro) e due input min/max prezzo
con debounce 300ms. Chip rimovibili sotto per ogni filtro attivo.
URL state esteso con categoryId, minPrice, maxPrice.

Mostra anche la colonna Aggiornato di default ora che il sort di default
e' updatedAt DESC (server-side).
EOF
)"
```

---

## Task 6: Verifica manuale e check finale

**Files:** nessuna modifica — solo verifica.

- [ ] **Step 1: Typecheck root**

Run:

```bash
bun run typecheck
```

Expected: zero errori in tutti i workspace.

- [ ] **Step 2: Test backend completi sulla suite seller-products**

Run:

```bash
bun test apps/api/tests/integration/seller-products-filters.test.ts \
         apps/api/tests/integration/seller-products.test.ts \
         apps/api/tests/integration/seller-products-search.test.ts
```

Expected: tutti i test PASS.

- [ ] **Step 3: Lint**

Run:

```bash
bun run lint
```

Expected: zero errori. Se Biome propone fix automatici sui nuovi file, applicarli e ri-stage.

- [ ] **Step 4: Dev server seller**

Run in un terminale separato:

```bash
bun run dev:seller
```

Aprire `http://localhost:3003`, login come seller con almeno un negozio e qualche prodotto (eventualmente popolare con `bun run db:seed` se necessario — solo su DB freshly reset).

- [ ] **Step 5: Smoke test visivo (golden path)**

In `/products`:

1. Verifica che le righe siano ordinate per `updatedAt` decrescente (colonna "Aggiornato" visibile).
2. Clic su `[Filtri ▾]` → popover apre.
3. Cerca una categoria nel CommandInput → la lista filtra.
4. Clic su una categoria foglia → chip "Categoria: X" appare sotto, tabella filtra.
5. Digita "5" in Min → dopo ~300ms parte la request, tabella si aggiorna.
6. Digita "100" in Max → parte request, chip "Prezzo: 5,00 € – 100,00 €".
7. Min=200, Max=100 → hint inline "Min superiore a max" sotto i campi.
8. Clic su ✕ della chip categoria → solo quel filtro si rimuove, prezzo resta.
9. Clic su "Reset" nel popover → tutti i filtri spariscono.
10. Imposta dei filtri → copia URL → apri in nuova tab → stato ripristinato.

- [ ] **Step 6: Smoke test edge cases**

1. Categoria con 0 prodotti → empty state "Nessun prodotto attivo" (esistente).
2. Tab Cestino (`statusFilter=trashed`) con filtri attivi → i filtri continuano a valere.
3. Click su un'altra colonna sortable (es. "Nome") → sort esplicito vince, l'ordine cambia, ma rimuovere il sort esplicito (re-click finché torna asc/desc/none) deve ripristinare l'ordine default `updatedAt DESC`.
4. Browser back/forward attraversa stati con filtri diversi → i campi Min/Max si riallineano.

Se uno qualsiasi di questi punti non si comporta come descritto, annotare il problema e fixare prima di procedere.

- [ ] **Step 7: Nessun commit (è solo verifica).** Se sono stati fatti fix piccoli (es. classi Tailwind), committare con `fix(seller): …` separatamente.

---

## Task 7: PR

**Files:** nessuna modifica.

- [ ] **Step 1: Push del branch**

```bash
git push -u origin feat/seller-products-filters
```

- [ ] **Step 2: Apri la PR**

Run (sostituendo eventuali nomi se diversi):

```bash
gh pr create --title "feat(seller): filtri prezzo/categoria + sort default updatedAt sulla lista prodotti" --body "$(cat <<'EOF'
## Summary
- Nuovo popover Filtri accanto alla search nella lista prodotti seller (`/products`): dropdown searchable sulla categoria foglia raggruppata per macro, due input min/max prezzo con debounce 300ms.
- Chip rimovibili sotto il bar per ogni filtro attivo.
- URL state esteso con `categoryId`, `minPrice`, `maxPrice` (coerente con `q`, `sort`, `statusFilter`).
- Sort di default lato API passa da `createdAt DESC` a `updatedAt DESC` con `createdAt` come tiebreaker stabile → la colonna "Aggiornato" diventa visibile di default nella tabella.

## Spec
`docs/superpowers/specs/2026-05-22-seller-products-filters-design.md`

## Test plan
- [ ] `bun run typecheck` verde
- [ ] `bun test apps/api/tests/integration/seller-products-filters.test.ts` verde (incluso il nuovo `describe("default sort")`)
- [ ] `bun run lint` verde
- [ ] Smoke test manuale su `/products` (dev:seller):
  - [ ] Default order = updatedAt DESC, colonna Aggiornato visibile
  - [ ] Popover apre/chiude, categoria filtra, chip categoria rimovibile
  - [ ] Min/Max prezzo debounced, chip prezzo formato IT (5,00 € – 100,00 €), validation hint inline
  - [ ] Reset svuota tutti i filtri
  - [ ] URL state condiviso (copia URL → nuova tab → stato ripristinato)
  - [ ] Back/forward del browser riallinea i campi locali

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verifica check CI in attesa**

```bash
gh pr checks
```

Expected: i check partono. Se rossi, investigare e fixare; se verdi, la PR è pronta per la review.

- [ ] **Step 4: Non chiudere la PR né mergerla in autonomia — Marco decide quando mergerla.**

---

## Spec ↔ Plan coverage

| Spec requirement | Task |
|---|---|
| Cambio default sort `updatedAt DESC, createdAt DESC` | Task 1 (test) + Task 2 (impl) |
| URL state esteso (`categoryId`, `minPrice`, `maxPrice`) | Task 5 step 2-3 |
| `ProductsFilterPopover` con categoria + prezzo | Task 3 |
| `ProductsFilterBar` con chip rimovibili | Task 4 |
| Integrazione nella route | Task 5 step 5 |
| Colonna `updatedAt` visibile di default | Task 5 step 4 |
| Debounce prezzo 300ms | Task 3 (useDebouncedValue) |
| Validation inline `min > max` | Task 3 (priceHint) |
| Conversione `,` → `.` decimale | Task 3 (normalizePrice) |
| Reset paginazione su cambio filtro | Task 5 step 5 (`page: 1` in navigate) |
| Test integration: default sort + tiebreaker | Task 1 |
| Verifica manuale golden + edge | Task 6 |
