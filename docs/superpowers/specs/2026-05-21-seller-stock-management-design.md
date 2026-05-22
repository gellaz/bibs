# Gestione stock prodotti per negozio (seller)

**Data**: 2026-05-21
**Scope**: `apps/api/src/modules/seller` (nuovi endpoint stock + sort), `apps/seller` (lista prodotti, dettaglio prodotto, bulk toolbar, nuovi componenti stock).
**Out of scope**: audit log delle modifiche di stock, threshold / colori / filtro "in esaurimento", customer & admin app, cambiare il comportamento di `/products/new` (resta single-store), endpoint o UI per spostare stock cross-store ("trasferisci da Store A a Store B").

## Obiettivo

Dare al seller un modo **immediato e coerente** per leggere e modificare le quantità di stock per negozio. Oggi la lista prodotti `/products` non mostra lo stock, e il dettaglio mostra solo numeri read-only con un cestino — non esiste alcun modo nell'UI di **incrementare o decrementare** lo stock di un prodotto, nonostante l'API `PATCH /products/:id/stores/:storeId` lo permetta. Inoltre, l'unico modo per "associare lo stesso prodotto a un altro negozio" è chiamare l'API direttamente: l'UI non lo espone.

Il design copre:

- una **cella stock editable inline** nella lista prodotti, con stepper +/- e input numerico, scoped sull'active store
- l'azione **"Aggiungi a un altro negozio"** sulla riga prodotto (e nel dettaglio), che associa lo stesso prodotto a uno o più negozi del seller
- un'azione di **bulk adjust** dalla toolbar per modificare lo stock di N prodotti selezionati in una sola operazione
- un refactor del **dettaglio prodotto**: scoping sull'active store (coerente con la lista), con riga informativa "Disponibile anche in: …" per gli altri negozi accessibili
- un endpoint API **atomico per delta** per evitare lost-update con più impiegati che operano sullo stesso store

## Decisioni chiave (negoziate in brainstorming)

| Tema | Decisione |
|---|---|
| Posizione principale UX | Colonna `Stock` inline nella lista `/products`. La lista è già scoped sull'active store via `storeId` → la cella mostra/edita solo quella riga. |
| Multi-store nella lista | Solo active store. Per i prodotti presenti in più negozi, l'edit cross-store passa per lo store switcher. |
| Input model | Stepper `[-] [valore] [+]` nella cella. `+` e `-` fanno delta atomico, il numero è anche un input cliccabile per il set assoluto. |
| Signaling visivo | Nessuno. Solo il numero. Niente threshold, colori, filtro "in esaurimento". |
| Estensioni in scope | Bulk adjust (selezione multipla → delta o set uniforme). Endpoint atomico delta backend. Action row "Aggiungi a un altro negozio". |
| Estensioni out of scope | Audit log, threshold, ProductStockManager con editor cross-store, customer/admin app. |
| Mutation timing | Optimistic UI + debounce 500ms con accumulo delta. Click rapidi su `+`/`-` coalescono in una singola POST `{ delta: somma }`. |
| API shape | Due endpoint distinti: `PATCH …/stores/:storeId` (esistente, set assoluto) + nuovo `POST …/stores/:storeId/stock-adjust` (delta atomico). |
| Authz | Riusa `ensureStoreAccess` esistente: owner = tutti i suoi store; employee = solo quelli in `store_employee_stores`. Nessun nuovo guard, nessun nuovo controllo a livello service. |
| Atomicity | `UPDATE … SET stock = stock + :delta WHERE … AND stock + :delta >= 0 RETURNING *`. Se `rowCount = 0` → SELECT per distinguere 404 da 409. |
| Sort backend `stock` | Implementato lato service. Richiede `storeId` (la lista è scoped) → 400 altrimenti. Quando `q` è attivo vince la rilevanza, come gli altri sort. |
| Bulk adjust scope | Un solo `storeId` per chiamata (l'active store del chiamante). Coerente con la lista. Tre modalità: `delta-add`, `delta-sub`, `set`. Max 100 productIds. |
| Bulk partial failure | Best-effort: succeeded[] + failed[] con reason `would_go_negative` o `not_found`. Toast aggregato senza dettaglio per-prodotto. |
| Dettaglio prodotto | Scoped sull'active store: solo la riga del prodotto in active store è editabile. Sotto, una riga informativa `Disponibile anche in: …` filtrata sugli store accessibili al chiamante. |
| Dettaglio empty state | Se il prodotto NON è sull'active store: empty state con button "Rendi disponibile in questo negozio". |
| Cross-store add | `StoreAssignmentDialog` riusato da row action e da dettaglio prodotto: multi-select degli store del seller in cui il prodotto NON è ancora associato + input "Stock iniziale" (default 0). |
| Label dell'azione | "Aggiungi a un altro negozio" (non "Duplica") perché l'azione non crea un nuovo `product.id`: associa lo stesso prodotto a un altro store. |
| DB migrations | Nessuna. Schema invariato. |

---

## Architettura — Backend

### Nuovi endpoint in `apps/api/src/modules/seller/`

#### 1. Adjust singolo (delta atomico)

```
POST /seller/products/:productId/stores/:storeId/stock-adjust
Body: { delta: number }                           // integer ≠ 0, [-1000, 1000]
Auth route-level: { auth: true } + ensureStoreAccess(storeId, ctx)
Auth service-level: ensureProductOwnership(productId, sellerProfileId)
Response 200: { data: StoreProductSchema }        // riga aggiornata
Errors:
  404 — product not found / store-product link missing / store non del seller (owner)
  403 — employee senza accesso allo storeId
  409 — stock_negative (delta porterebbe stock < 0)
```

Pattern coerente con `updateStock` esistente (`stock.ts:62-95`): `ensureStoreAccess` nel route handler, `ensureProductOwnership` nel service.

Service `adjustStock` in `modules/seller/services/stock.ts`:

```ts
interface AdjustStockParams {
  productId: string;
  storeId: string;
  sellerProfileId: string;
  delta: number;
}

export async function adjustStock(params: AdjustStockParams) {
  const { productId, storeId, sellerProfileId, delta } = params;
  await ensureProductOwnership(productId, sellerProfileId);

  // UPDATE atomico con guard sul check non-negative
  const [updated] = await db
    .update(storeProduct)
    .set({ stock: sql`${storeProduct.stock} + ${delta}` })
    .where(
      and(
        eq(storeProduct.productId, productId),
        eq(storeProduct.storeId, storeId),
        sql`${storeProduct.stock} + ${delta} >= 0`,
      ),
    )
    .returning();

  if (updated) return updated;

  // rowCount = 0 → distingui 404 da 409 con un SELECT
  const existing = await db.query.storeProduct.findFirst({
    where: and(
      eq(storeProduct.productId, productId),
      eq(storeProduct.storeId, storeId),
    ),
  });
  if (!existing) throw new ServiceError(404, "Store-product link not found");
  throw new ServiceError(409, "Stock would go negative", { code: "stock_negative" });
}
```

#### 2. Bulk adjust

```
POST /seller/products/bulk/stock-adjust
Body: discriminated union (vedi schema sotto)
Auth route-level: { auth: true } + ensureStoreAccess(storeId, ctx) UNA volta
Auth service-level: filtro productIds per sellerProfileId (NOT ensureProductOwnership: tirerebbe eccezione al primo non-match)
Response 200: { data: { succeeded: StoreProductSchema[], failed: Array<{ productId, reason }> } }
Errors:
  400 — body shape (mode/value out of bounds)
  403 — employee senza accesso allo storeId
```

Service `bulkAdjustStock` — best-effort, no transaction globale (ogni row UPDATE commit indipendente, atomicity per-row garantita dal `WHERE stock + delta >= 0`):

1. SELECT `product.id` WHERE `id IN productIds AND sellerProfileId = ctx.sellerProfileId` → produce `ownedIds: Set<string>`
2. `productIds \ ownedIds` → vanno in `failed[]` con `reason: "not_found"` (non leakare cross-seller)
3. Per ogni id in `ownedIds`: UPDATE atomico per-row con guard non-negative. `rowCount = 0` → SELECT discrimina:
   - link assente per quello store → `failed[].reason = "not_found"`
   - link esiste ma `stock + delta < 0` (solo per mode=delta) → `failed[].reason = "would_go_negative"`
4. Limite hardcoded `maxItems: 100` come negli altri bulk endpoint

I succeeded restano committati anche se altri row falliscono — semantica best-effort coerente con `bulkUpdateProductStatus` e `bulkDeletePermanent` esistenti.

Per `mode=set`, `value < 0` è già escluso dallo schema; non può mai violare il check non-negative.

Per `mode=delta`, `value=0` è no-op silenzioso: i prodotti del seller con link esistente finiscono in `succeeded[]` con stock invariato. Non viene rifiutato a livello schema per semplicità.

#### 3. Sort `stock` su `GET /seller/products`

Estensione di `ProductSortField` in `listProducts` (`apps/api/src/modules/seller/services/products.ts:78`):

```ts
type ProductSortField = "name" | "price" | "ean" | "createdAt" | "updatedAt" | "stock";
```

Nuovo case nello `orderByClauses` (riga 210-228):

```ts
case "stock":
  if (!storeId) throw new ServiceError(400, "sort=stock requires storeId");
  return [dir(storeProduct.stock), desc(product.createdAt)];
```

Il base query del ramo non-search già fa `innerJoin(storeProduct, ...)` quando `storeId` è presente, quindi `storeProduct.stock` è raggiungibile senza modifiche al join.

Quando `q` (search) è attivo: la rilevanza vince (no-op), pattern coerente con tutti gli altri sort.

#### Schemas in `lib/schemas/`

Nuovo file `stock.ts` (o estensione di `entities.ts`):

```ts
export const StockAdjustBody = t.Object({
  delta: t.Integer({
    minimum: -1000,
    maximum: 1000,
    description: "Variazione di stock (+/-). Range [-1000, 1000].",
  }),
});

// Discriminated union: bounds di `value` cambiano in base a `mode`
export const StockBulkAdjustBody = t.Union([
  t.Object({
    storeId: t.String({ description: "ID negozio (l'active del chiamante)" }),
    mode: t.Literal("delta"),
    value: t.Integer({
      minimum: -1000,
      maximum: 1000,
      description: "Variazione (segno + per aumentare, - per diminuire). 0 ammesso ma no-op.",
    }),
    productIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }),
  }),
  t.Object({
    storeId: t.String({ description: "ID negozio (l'active del chiamante)" }),
    mode: t.Literal("set"),
    value: t.Integer({
      minimum: 0,
      maximum: 100000,
      description: "Valore assoluto da impostare per tutti i prodotti selezionati.",
    }),
    productIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }),
  }),
]);

export const StockBulkAdjustResult = t.Object({
  succeeded: t.Array(StoreProductSchema),
  failed: t.Array(
    t.Object({
      productId: t.String(),
      reason: t.Union([t.Literal("not_found"), t.Literal("would_go_negative")]),
    }),
  ),
});
```

Re-export da `lib/schemas/index.ts`.

### Logging

Pattern coerente con il resto del modulo seller (`pino.info({ action: "..." })`):

- `adjustStock` success: `action: "stock_adjusted"` con `productId, storeId, delta, newStock, userId, sellerProfileId`
- `bulkAdjustStock`: `action: "stock_bulk_adjusted"` con `requested, succeeded, failed, mode, value, storeId, userId`

Nessun audit log nel `product_audit_log` (out of scope).

---

## Architettura — Frontend `apps/seller`

### Nuovi componenti

```
apps/seller/src/features/products/
├── components/
│   ├── stock-editor-cell.tsx              # NUOVO — stepper +/- + input editabile
│   ├── store-assignment-dialog.tsx        # NUOVO — multi-select store per assegnare prodotto
│   ├── bulk-stock-adjust-dialog.tsx       # NUOVO — dialog bulk con tabs Aumenta/Diminuisci/Imposta
│   ├── product-stock-manager.tsx          # REFACTOR — scoped sull'active store
│   ├── product-row-actions.tsx            # MODIFICA — nuova voce menu "Aggiungi a un altro negozio"
│   └── product-bulk-toolbar.tsx           # MODIFICA — nuovo button "Adegua stock"
└── hooks/
    ├── use-stock-adjust-mutation.ts       # NUOVO — adjust + set mutation
    └── use-bulk-stock-adjust-mutation.ts  # NUOVO — bulk mutation
```

### `StockEditorCell` (cuore dell'UX)

Componente riusato dalla lista prodotti e dal dettaglio prodotto.

```tsx
interface Props {
  productId: string;
  storeId: string;
  stock: number;                  // valore canonico dal server (via React Query cache)
  readOnly?: boolean;             // default false. true → solo testo, niente bottoni/input
}
```

Stato interno:

- `pendingDelta: number` (default 0) — accumulo dei click ±1
- `flushTimer` (debounce 500ms)
- `editMode: boolean` — quando true, il numero è un input controllato per il set assoluto
- `localValue: number | "editing"` — valore visibile (= `stock + pendingDelta` o l'editing value)

Comportamento:

| Stato | Resa | Azione |
|---|---|---|
| Idle | `[ - ]  [ 47 ]  [ + ]` (tabular-nums) | hover: bordo leggero |
| Click `+` | numero +1 immediato, dot spinner accanto | pendingDelta++; restart timer 500ms |
| Click `-` (stock > 0) | numero -1 immediato | pendingDelta--; restart timer 500ms |
| Click `-` con `stock + pendingDelta = 0` | bottone `-` disabilitato | — |
| Flush timer | POST `/stock-adjust` con `{ delta: pendingDelta }` | azzera buffer; on success setQueryData con risposta server |
| Click sul numero | input focused, autoSelect totale | edit mode |
| Enter in edit mode | PATCH `/stores/:storeId` con `{ stock: value }` | uscita edit mode; on success setQueryData |
| Esc / blur senza modifiche | torna a idle, valore canonico | nessuna request |
| Mutation 409 | toast "Lo stock non può scendere sotto zero" | rollback al valore server |
| Mutation 403 | toast "Accesso al negozio negato" | rollback (raro: cambio permessi mid-session) |
| `readOnly` | solo numero, font tabular-nums | — |

Note di correttezza:

- I delta sono **commutativi**: anche se due flush partono fuori ordine, il valore finale lato server è corretto. La UI segue però l'ultima `setQueryData` ricevuta.
- Un click che porterebbe stock virtualmente sotto zero viene **bloccato lato client** (bottone `-` disabilitato a `stock + pendingDelta = 0`) per evitare 409 prevedibili.
- Se la mutation è in volo e l'utente clicca ancora `+`/`-`, il nuovo input va in un buffer nuovo: un secondo flush parte al success del precedente. Niente race semantica.

### `useStockAdjustMutation`

Hook unificato per la cella e altri consumer:

```ts
const { adjust, set } = useStockAdjustMutation();
// adjust({ productId, storeId, delta })  → POST stock-adjust
// set({ productId, storeId, stock })     → PATCH stores/:storeId
```

Su success:

- `setQueryData(["product", productId], …)` — patcha il singolo `storeProducts` matchante con la response
- `setQueryData` mirato su tutte le query con `queryKey[0] === "products"` — patcha la row matchante per evitare refetch della lista

Su error: ritorna l'errore al chiamante (la cella fa rollback). Nessun toast nel hook stesso.

### Modifiche a `apps/seller/src/routes/_authenticated/products/index.tsx`

#### Nuova colonna `stock`

Inserita tra `price` e `category`, visibile di default:

```tsx
{
  id: "stock",
  header: ({ column }) => <SortableHeader column={column}>Stock</SortableHeader>,
  enableSorting: true,
  meta: {
    headerClassName: "w-[14%]",
    cellClassName: "tabular-nums",
    menuLabel: "Stock",
  },
  cell: ({ row }) => {
    const sp = row.original.storeProducts.find((sp) => sp.storeId === activeStore?.id);
    if (!sp) return <span className="text-muted-foreground/60">—</span>;
    return (
      <StockEditorCell
        productId={row.original.id}
        storeId={activeStore!.id}
        stock={sp.stock}
      />
    );
  },
}
```

#### `SORT_FIELDS` e validazione search params

```ts
const SORT_FIELDS: ProductSortField[] = ["name", "price", "ean", "stock", "createdAt", "updatedAt"];
```

#### Passaggio nuova prop a `ProductRowActions`

```tsx
<ProductRowActions
  productId={row.original.id}
  status={row.original.status}
  activeStoreId={activeStore?.id ?? ""}
  assignedStoreIds={row.original.storeProducts.map((sp) => sp.storeId)}  // ← NUOVA
/>
```

### Modifiche a `ProductRowActions`

Nuova prop `assignedStoreIds: string[]`. Nuova voce di menu (posizionata tra "Modifica" e "Copia ID"), visibile solo per `status !== "trashed"`:

```tsx
<DropdownMenuItem onSelect={() => setAddStoreOpen(true)}>
  <CopyPlusIcon /> Aggiungi a un altro negozio
</DropdownMenuItem>
```

E dialog renderizzato condizionato:

```tsx
<StoreAssignmentDialog
  productId={productId}
  assignedStoreIds={assignedStoreIds}
  open={addStoreOpen}
  onOpenChange={setAddStoreOpen}
/>
```

### `StoreAssignmentDialog`

Componente riusato anche dal dettaglio prodotto (vedi sotto).

```tsx
interface Props {
  productId: string;
  assignedStoreIds: string[];     // store già associati al prodotto
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}
```

Comportamento:

- All'apertura: `useQuery({ queryKey: ["seller-stores"], ... })` — query già usata in altre parti della app (riuso della cache).
- `accessibleStores = data` (l'API ritorna SOLO gli store accessibili al chiamante per definizione).
- `availableStores = accessibleStores.filter((s) => !assignedStoreIds.includes(s.id))`.
- Se `availableStores.length === 0`: messaggio "Questo prodotto è già disponibile in tutti i tuoi negozi" + button "Chiudi", niente submit.
- Altrimenti: lista con `Checkbox` (pattern single-table-with-row-state, no split pane), più un input numerico "Stock iniziale" (default 0, integer ≥ 0).
- Submit → `POST /seller/products/:id/stores` con `{ storeIds: selected, stock: initialStock }`.
- Su success: invalidate `["product", productId]` e `["products"]`, toast `Aggiunto a N negozi`, chiama `onSuccess?.()`, chiude.

### Modifiche a `ProductBulkToolbar`

Nuovo button "Adegua stock", visibile solo per `statusFilter === "active"`:

```tsx
{statusFilter === "active" && (
  <>
    <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
      <PackageIcon /> Adegua stock
    </Button>
    <Button size="sm" onClick={apply("disabled")}>...</Button>
    <Button size="sm" variant="destructive" onClick={apply("trashed")}>...</Button>
  </>
)}

<BulkStockAdjustDialog
  open={adjustOpen}
  onOpenChange={setAdjustOpen}
  productIds={selectedIds}
  storeId={activeStoreId}
  onSuccess={onClear}
/>
```

### `BulkStockAdjustDialog`

```tsx
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productIds: string[];           // 1..100
  storeId: string;
  onSuccess: () => void;
}
```

Layout:

- Titolo: "Adegua stock di N prodotti"
- Sottotitolo: "In [Nome Active Store]"
- Tabs (shadcn): `[Aumenta] [Diminuisci] [Imposta a]`
- Input numerico "Quantità" (form: react-hook-form + zod)
  - `delta-add` / `delta-sub`: integer 1..1000
  - `set`: integer 0..100000
- Warning visibile solo se `mode === "set"` e `value === 0`: "⚠ Imposterai lo stock di N prodotti a 0."
- Footer: `[Annulla] [Conferma]`

Submit body mapping:

- `delta-add` → `{ mode: "delta", value: +N }`
- `delta-sub` → `{ mode: "delta", value: -N }`
- `set` → `{ mode: "set", value: N }`

Response handling:

```ts
onSuccess: (result) => {
  // patcha le righe succeeded in tutte le query ["products", ...]
  patchProductsCache(result.succeeded);

  if (result.failed.length === 0) {
    toast.success(`Stock aggiornato per ${result.succeeded.length} prodotti`);
  } else {
    const neg = result.failed.filter(f => f.reason === "would_go_negative").length;
    const nf  = result.failed.filter(f => f.reason === "not_found").length;
    const parts = [];
    if (neg) parts.push(`${neg} con stock insufficiente`);
    if (nf)  parts.push(`${nf} non più disponibili`);
    toast.warning(`${result.succeeded.length} aggiornati. ${result.failed.length} ignorati: ${parts.join(", ")}.`);
  }
  onSuccess(); // toolbar.onClear
  onOpenChange(false);
}
```

### Refactor `ProductStockManager` (dettaglio prodotto)

File: `apps/seller/src/features/products/components/product-stock-manager.tsx`.

Modello: **scoped sull'active store**. Una sola riga editabile (l'active row), riga info read-only per gli altri store accessibili.

```tsx
"use no memo";

interface Props {
  productId: string;
  storeProducts: StoreProduct[];   // come oggi
}

export function ProductStockManager({ productId, storeProducts }: Props) {
  const { activeStore } = useActiveStore();
  const { data: accessibleStores } = useQuery({ queryKey: ["seller-stores"], ... });

  const accessibleSet = useMemo(
    () => new Set(accessibleStores?.map((s) => s.id) ?? []),
    [accessibleStores],
  );
  const activeRow = storeProducts.find((sp) => sp.storeId === activeStore?.id);
  const otherAccessible = storeProducts.filter(
    (sp) => sp.storeId !== activeStore?.id && accessibleSet.has(sp.storeId),
  );
  const assignedStoreIds = storeProducts.map((sp) => sp.storeId);
  const [addOpen, setAddOpen] = useState(false);

  // removeMutation invariato (riusa l'esistente DELETE)
  // assignActiveMutation: POST /products/:id/stores con { storeIds: [activeStore.id], stock: 0 }
}
```

Rendering:

1. **Heading**: "Disponibilità" + sottotitolo "Quantità nel negozio attivo. Usa i bottoni +/- o clicca sul numero per impostare un valore."
2. **Active row**:
   - Se `activeRow` esiste:
     ```
     [icona] Active Store Name        [- 47 +]    [cestino]
              Città
     ```
     `StockEditorCell` editabile, button cestino (riusa `removeMutation`).
   - Altrimenti: empty state "Questo prodotto non è disponibile in [Active Store Name]." + button "Rendi disponibile in questo negozio" → chiama `assignActiveMutation`.
3. **Riga info** (solo se `otherAccessible.length > 0`):
   ```
   Disponibile anche in: Negozio B (12), Negozio C (3)
   ```
   `text-muted-foreground text-xs`, niente bottoni.
4. **Button "+ Rendi disponibile in un altro negozio"**: outline a tutta larghezza → apre `StoreAssignmentDialog`.

Authz frontend: nessun controllo aggiuntivo. L'active store è sempre accessibile al chiamante (lo store switcher mostra solo i suoi). Per la riga info, il filtro `accessibleSet` nasconde gli store non gestiti.

Copy: rimuovo "Gestisci le quantità dalla sezione Inventario del negozio" (leftover obsoleto di una sezione mai esistita).

### Cache invalidation cross-page

| Azione | Cache changes |
|---|---|
| `adjust` / `set` (StockEditorCell) | `setQueryData(["product", productId])` + `setQueryData(["products", ...all])` |
| `removeMutation` (cestino sul dettaglio) | invalidate `["product", productId]` + `["products"]` |
| `assignActiveMutation` (empty state dettaglio) | invalidate `["product", productId]` + `["products"]` |
| `StoreAssignmentDialog.onSuccess` | invalidate `["product", productId]` + `["products"]` |
| `BulkStockAdjustDialog.onSuccess` | `setQueryData(["products", ...all])` patchando le `succeeded[]` |

### Stringhe i18n (paraglide)

Nuove chiavi in `apps/seller/messages/it.json` **e** `apps/seller/messages/en.json` (entrambi esistono, paraglide richiede parità delle chiavi):

- `products_stock_column_header` → "Stock"
- `products_action_add_to_store` → "Aggiungi a un altro negozio"
- `products_bulk_adjust_stock_button` → "Adegua stock"
- `products_bulk_adjust_dialog_title` → "Adegua stock di {count} prodotti"
- `products_bulk_adjust_dialog_subtitle` → "In {storeName}"
- `products_bulk_adjust_tab_add` → "Aumenta"
- `products_bulk_adjust_tab_sub` → "Diminuisci"
- `products_bulk_adjust_tab_set` → "Imposta a"
- `products_bulk_adjust_field_quantity` → "Quantità"
- `products_bulk_adjust_warning_zero` → "Imposterai lo stock di {count} prodotti a 0."
- `products_bulk_adjust_success` → "Stock aggiornato per {count} prodotti"
- `products_bulk_adjust_partial_warning` → "{ok} aggiornati. {failed} ignorati: {breakdown}."
- `products_stock_manager_heading` → "Disponibilità"
- `products_stock_manager_subtitle` → "Quantità nel negozio attivo. Usa i bottoni +/- o clicca sul numero per impostare un valore."
- `products_stock_manager_empty_active` → "Questo prodotto non è disponibile in {storeName}."
- `products_stock_manager_make_available_here` → "Rendi disponibile in questo negozio"
- `products_stock_manager_also_in` → "Disponibile anche in:"
- `products_stock_manager_add_to_another` → "Rendi disponibile in un altro negozio"
- `products_store_assignment_dialog_title` → "Aggiungi a un altro negozio"
- `products_store_assignment_dialog_initial_stock` → "Stock iniziale"
- `products_store_assignment_dialog_all_covered` → "Questo prodotto è già disponibile in tutti i tuoi negozi."
- `products_stock_error_negative` → "Lo stock non può scendere sotto zero."

---

## Authz (richiamo invariante)

Tutti gli endpoint stock (esistenti e nuovi) devono passare per `ensureStoreAccess(storeId, ctx)`:

- **Owner**: tutti gli store del seller (404 se lo store non gli appartiene o è cancellato)
- **Employee**: solo gli store in `store_employee_stores` (403 altrimenti)

Per `POST bulk/stock-adjust`: il guard viene applicato una sola volta sullo `storeId` del body (è un singolo store per chiamata). I `productIds` vengono filtrati via **SELECT batch** `WHERE id IN productIds AND sellerProfileId = ctx.sellerProfileId`: NON si usa `ensureProductOwnership` perché tirerebbe eccezione al primo id non-match, mentre il bulk è best-effort. I productIds di altri seller finiscono in `failed[].reason = "not_found"`.

Per il dettaglio prodotto: `getProduct` continua a ritornare tutti gli `storeProducts` (serve per la riga info "anche in: …" sul FE). La verifica di accessibility (`storeProducts.some(sp => accessibleStoreIds.includes(sp.storeId))`) resta invariata: un employee può aprire il dettaglio solo se ha accesso ad almeno uno degli store in cui il prodotto è associato.

---

## Test

### Backend integration tests

Nuovo file `apps/api/tests/integration/seller-product-stock.test.ts`:

| Test | Setup | Asserts |
|---|---|---|
| adjust delta positivo | stock=5 | 200, stock=8 con delta=+3 |
| adjust delta negativo | stock=5 | 200, stock=2 con delta=-3 |
| adjust 409 would-go-negative | stock=2 | 409 `code: stock_negative`, DB invariato |
| adjust 404 product missing | productId fake | 404 |
| adjust 404 store-product link missing | prodotto NON in quello store | 404 |
| adjust 403 employee senza accesso allo store | employee → store altro | 403 |
| adjust atomicity | `Promise.all([+1, +1])` da stock=10 | stock finale = 12 |
| bulk delta su 3 prodotti | stock 5/10/3, delta=+2 | succeeded.length=3 |
| bulk set su 3 prodotti | tutti a 20 | succeeded.length=3, stock=20 |
| bulk partial failure | 1 prodotto con stock=1 e delta=-5 | succeeded=2, failed=[{ reason: "would_go_negative" }] |
| bulk 403 employee | employee → store altro | 403 |
| bulk maxItems=100 | 101 ids | 400 |

Estensione di `apps/api/tests/integration/seller-products-filters.test.ts`:

| Test | Asserts |
|---|---|
| sort=stock asc | order by stock asc |
| sort=stock desc | order by stock desc |
| sort=stock senza storeId | 400 |
| sort=stock + q attivo | order by relevance (sort=stock ignorato) |

### Frontend verification (manual flow)

Nessuna infra di test FE su `apps/seller`. Verifica manuale in browser dopo `bun run dev:seller`:

1. **Inline delta**: in `/products` clicco +5 e -3 in sequenza rapida → una sola POST con `delta: +2`, no flicker
2. **Inline set**: clicco sul numero, edit "50", Enter → PATCH stock=50, value aggiornato
3. **Inline 409**: stock=2, clicco -3 → toast errore, rollback
4. **Inline Esc**: clicco sul numero, modifico, premo Esc → rollback, no request
5. **Sort stock**: click header → URL aggiornato, lista riordinata
6. **Row action "Aggiungi a un altro negozio"**: con seller a 2 store, prodotto solo in Store A → dialog mostra Store B → conferma → prodotto ora anche in Store B
7. **Dettaglio active store**: vedo solo la riga active editabile, "anche in: …" coerente con le assegnazioni
8. **Dettaglio empty state**: prodotto non in active → empty + button "Rendi disponibile" funziona
9. **Bulk happy**: selezione 3 prodotti, "Adegua stock", `Aumenta 10` → toast, stock +10
10. **Bulk partial failure**: uno a stock=0, applico `Diminuisci 1` → toast warning con breakdown
11. **Bulk set 0 warning**: scelta `Imposta a 0` mostra warning inline
12. **Employee scope**: login come employee a 1 di 3 store → lista solo Store A, dettaglio solo Store A, riga "anche in:" assente per i non assegnati

### Gating commands (PR-time)

```bash
bun run typecheck
bun run lint
(cd apps/api && bun test seller-product-stock seller-products-filters)
```

---

## Rollout

Feature additiva, low-risk. App in stage dev (`project_dev_stage_no_prod`), nessun customer reale impattato.

Niente feature flag. Niente DB migration.

PR singola accettabile (~700 righe stimate). In alternativa, spezzabile in 4 PR ordinate per landa-bilità (decisione a `writing-plans` time):

1. **Backend**: nuovi endpoint + sort=stock + tests (~250 righe)
2. **Frontend lista**: `StockEditorCell` + colonna + sort + hook (~200 righe)
3. **Frontend dettaglio + assignment dialog**: refactor `ProductStockManager` + `StoreAssignmentDialog` + row action (~200 righe)
4. **Bulk**: `BulkStockAdjustDialog` + toolbar update + hook (~150 righe)

OpenAPI: i nuovi endpoint hanno `detail.description` in italiano coerente con il resto del modulo seller, appariranno automaticamente in `/openapi`.
