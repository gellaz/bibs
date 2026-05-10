# Seller — Azioni rapide e bulk sulla tabella prodotti

**Data**: 2026-05-10
**Scope**: `apps/api`, `apps/seller`
**Out of scope**: `apps/admin`, `apps/customer` (cambia solo la query di search del customer per allinearsi al nuovo campo `status`); UI di lettura del nuovo audit log; varianti prodotto; cestino auto-purge cron; bulk operations > 100 IDs in singola chiamata.

## Obiettivo

Aggiungere alla pagina `/_authenticated/products` dell'app seller (`apps/seller`) tre capacità che oggi mancano:

1. **Azioni rapide per riga**: ogni riga della tabella espone un menù di azioni (modifica, disabilita/riattiva, sposta nel cestino, ripristina, elimina definitivamente).
2. **Selezione multipla con bulk action**: checkbox per riga + select-all-on-page, con una toolbar che agisce su tutti i selezionati.
3. **Tre stati di prodotto** (`active` / `disabled` / `trashed`) presentati come tab, con cestino reversibile per assorbire i delete accidentali.

Per renderle production-ready servono modifiche di schema su `products`, `order_items`, e una nuova tabella `product_audit_log`. Il delete fisico di un prodotto diventa sicuro grazie alla denormalizzazione delle informazioni di prodotto sugli `order_items`: lo storico ordini resta integro anche dopo l'eliminazione.

## Decisioni chiave (negoziate in brainstorming)

| Tema | Decisione |
|---|---|
| Stato del prodotto | `text('status', { enum: ['active','disabled','trashed'] })` + `CHECK` constraint. Sostituisce `isActive` boolean. Default `'active'`. |
| Scelta `text + CHECK` vs `pgEnum` | `text + CHECK`. Validazione DB-side equivalente a `pgEnum`, type inference TS identica via Drizzle, ma migration friendly: aggiungere/rimuovere/rinominare valori = costante TS + drop/recreate del CHECK, niente `ALTER TYPE`. Decisione policy-level: `text + CHECK` è il default in bibs per colonne enumerate. |
| Cestino vs hard delete | Soft trash (`status='trashed'`) con UI di ripristino + endpoint `DELETE` separato che esegue il delete fisico solo dal cestino. Niente cron di purge automatica. |
| Integrità storica ordini | **Snapshot denormalizzato** sugli `order_items`: `productName`, `productEan`, `brandName`, `productImageUrl`. FK soft (`ON DELETE SET NULL`) verso `products`/`store_products` per il link "compra di nuovo" se il prodotto esiste ancora. Niente vincolo "non puoi eliminare se ha ordini" — il delete è sempre safe. |
| Audit log | Tabella `product_audit_log` con action enum (`created`, `updated`, `disabled`, `enabled`, `trashed`, `restored`). **Esclude** `deleted_permanently` perché il record verrebbe cancellato a cascata col prodotto: l'evento di delete fisico vive solo nei log Pino (`pino.warn`). Scritta nella stessa transazione del cambio di stato. UI di lettura **fuori scope** in questa PR — l'obiettivo è registrare, non visualizzare. |
| Endpoint API | `PATCH /:productId/status` per transizioni, `DELETE /:productId` per delete fisico (gated su `status='trashed'`), `POST /bulk/status` e `POST /bulk/delete-permanent` con response best-effort `{ succeeded, failed }`. Max 100 IDs per chiamata bulk. |
| Filtro lista | Query param `?statusFilter=active|disabled|trashed`. Default `'active'`. Tab UI fa una query per tab. Count per tab tramite `GROUP BY status`. |
| Layout azioni per riga | **Dropdown a tre puntini** (shadcn `DropdownMenu`) in coda alla riga. Click sul nome continua a portare alla pagina edit (primary action invariata). Voci dropdown context-aware per tab. |
| Conferme distruttive | Modal `AlertDialog` solo per `delete-permanent` (single e bulk). Tutte le altre azioni: action immediata + toast con "Annulla" che dispatcha la mutation inversa entro 5s. |
| Optimistic UI | Sì per single-row mutation (status change). No per bulk: count variabile e response best-effort, mostriamo skeleton + toast riassuntivo. |
| Limite bulk | Max 100 IDs per request. Validato via TypeBox. UI segmenta in chunk se necessario (raro). |

## Architettura — Schema DB

### Modifica: `products`

`apps/api/src/db/schemas/product.ts`

```ts
export const PRODUCT_STATUS = ['active', 'disabled', 'trashed'] as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[number];

export const product = pgTable(
  'products',
  {
    // ... campi esistenti invariati ...
    status: text('status', { enum: PRODUCT_STATUS })
      .default('active')
      .notNull(),
    // RIMOSSO: isActive boolean
  },
  (table) => [
    // ... indici esistenti modificati ...
    uniqueIndex('product_seller_ean_unique')
      .on(table.sellerProfileId, table.ean)
      .where(sql`${table.ean} IS NOT NULL AND ${table.status} != 'trashed'`),
    index('product_status_idx').on(table.status),
    check(
      'product_status_valid',
      sql`${table.status} IN ('active','disabled','trashed')`,
    ),
    // ... resto invariato (price check, ean format, ecc.) ...
  ],
);
```

L'unique index EAN va aggiornato per ignorare i prodotti in cestino, altrimenti un prodotto trashato blocca la creazione di un nuovo prodotto con lo stesso EAN.

### Modifica: `order_items`

`apps/api/src/db/schemas/order.ts`

```ts
export const orderItem = pgTable(
  'order_items',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    orderId: text('order_id')
      .notNull()
      .references(() => order.id, { onDelete: 'cascade' }),

    // === snapshot al momento dell'ordine (NUOVO) ===
    productName: text('product_name').notNull(),
    productEan: text('product_ean'),
    brandName: text('brand_name'),
    productImageUrl: text('product_image_url'),

    // === soft FK (CAMBIATO) ===
    productId: text('product_id').references(() => product.id, {
      onDelete: 'set null',
    }),
    storeProductId: text('store_product_id').references(
      () => storeProduct.id,
      { onDelete: 'set null' }, // era NOT NULL + 'restrict'
    ),

    // === esistenti invariati ===
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [
    index('order_item_order_id_idx').on(table.orderId),
    index('order_item_store_product_id_idx').on(table.storeProductId),
    index('order_item_product_id_idx').on(table.productId),
    check('order_item_quantity_positive', sql`${table.quantity} > 0`),
    check('order_item_unit_price_non_negative', sql`${table.unitPrice} >= 0`),
  ],
);
```

Cambia anche la logica di creazione di un `orderItem` (al checkout): leggi `name`, `ean`, `brand.name`, prima `productImage` ordinata, e copia i valori nelle colonne snapshot. Centralizza in helper `buildOrderItemSnapshot(storeProduct)` esportato dal modulo orders.

### Tabella nuova: `product_audit_log`

`apps/api/src/db/schemas/product-audit-log.ts` (nuovo file).

```ts
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { product } from './product';

// Esclude 'deleted_permanently' perché l'audit row verrebbe cancellato a cascata
// col prodotto: il delete fisico è registrato solo nei log Pino.
export const PRODUCT_AUDIT_ACTION = [
  'created',
  'updated',
  'disabled',
  'enabled',
  'trashed',
  'restored',
] as const;
export type ProductAuditAction = (typeof PRODUCT_AUDIT_ACTION)[number];

export const productAuditLog = pgTable(
  'product_audit_log',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    action: text('action', { enum: PRODUCT_AUDIT_ACTION }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('product_audit_product_occurred_idx').on(
      table.productId,
      table.occurredAt.desc(),
    ),
    index('product_audit_actor_idx').on(table.actorUserId),
    check(
      'product_audit_action_valid',
      sql`${table.action} IN ('created','updated','disabled','enabled','trashed','restored')`,
    ),
  ],
);
```

`actor_user_id` nullable perché:
- al cleanup di un utente Better Auth (`onDelete: 'set null'`) preserviamo lo storico azione;
- per future automazioni server-side senza utente attivo (cron, webhook).

`metadata jsonb` ospita info opzionali di azione, p.es. su `'updated'` possiamo memorizzare i campi modificati `{ changedFields: ['name','price'] }`. Per `'restored'` possiamo memorizzare `{ previousStatus: 'disabled' }` se utile.

`onDelete: 'cascade'` su `product_id`: quando il prodotto viene eliminato definitivamente, il suo audit log viene cancellato con lui. Trade-off accettabile: l'audit log serve a tracciare le azioni *durante la vita* del prodotto. Una volta eliminato, l'evidenza dell'azione di eliminazione resta nei log Pino, e i record di audit log dei prodotti ancora vivi non sono toccati.

### Schemi e relazioni

Aggiornare `apps/api/src/db/schemas/index.ts` per esportare il nuovo schema.

Niente nuova relations su `productAuditLog` se la lettura UI non è in scope: la query verrà fatta join-less. Si può aggiungere in PR successiva.

## Architettura — Service & API

### Helper: `recordProductAudit`

`apps/api/src/modules/seller/services/product-audit.ts` (nuovo).

```ts
interface RecordAuditParams {
  productId: string;
  actorUserId: string | null;
  action: ProductAuditAction;
  metadata?: Record<string, unknown>;
  tx?: DrizzleTransaction; // opzionale per chiamate fuori transazione
}

export async function recordProductAudit(params: RecordAuditParams): Promise<void>;
export async function recordProductAuditBatch(
  entries: RecordAuditParams[],
  tx?: DrizzleTransaction,
): Promise<void>;
```

Sempre invocato all'interno della stessa transazione del cambio di stato (per evitare drift tra stato e log). Nel test l'invocazione è facile da intercettare.

### Endpoint singolo

#### `PATCH /seller/products/:productId/status`

```ts
// Schema TypeBox in apps/api/src/lib/schemas/products.ts
const ProductStatusBody = t.Object({
  status: t.Union(PRODUCT_STATUS.map((s) => t.Literal(s))),
});
```

Logica del service `updateProductStatus`:

1. `withSeller(ctx)`, ricava `sp.id`, `accessibleStoreIds`.
2. Carica il prodotto: deve esistere, appartenere al `sellerProfile`, avere almeno uno `store_products` accessibile → 404 altrimenti.
3. `previousStatus = product.status`.
4. Se `previousStatus === requestedStatus`, no-op (200, no audit entry).
5. Altrimenti, in transazione:
   - `UPDATE products SET status = $new, updated_at = now() WHERE id = ...`
   - Determina action audit:
     - `(previous='active', new='disabled')` → `'disabled'`
     - `(previous='disabled', new='active')` → `'enabled'`
     - `(any, new='trashed')` → `'trashed'`
     - `(previous='trashed', new='active'|'disabled')` → `'restored'` (metadata: `{ previousStatus: 'trashed', newStatus: $new }`)
   - `recordProductAudit(...)` nella stessa tx.
6. Risposta `okRes(updatedProduct)`.

#### `DELETE /seller/products/:productId`

Riusa l'endpoint esistente, **cambia la semantica**: oggi fa hard delete sempre, dopo questa PR fa hard delete solo se il prodotto è in cestino.

Logica del service `deleteProductPermanently`:

1. `withSeller`, accessibilità come oggi.
2. Carica il prodotto. Se `status !== 'trashed'` → `409 Conflict` con messaggio "Sposta prima il prodotto nel cestino".
3. Carica le immagini per cleanup S3 (come oggi).
4. In transazione:
   - `pino.warn({ userId, sellerProfileId, productId, productName, productEan, action: 'product_deleted_permanently' }, 'Prodotto eliminato definitivamente')` — il delete fisico è registrato solo nei log Pino (livello warn), non nell'audit log del prodotto: il cascade su `product_audit_log.product_id` cancellerebbe la riga della cancellazione stessa.
   - `DELETE FROM products WHERE id = ...`
5. Cleanup S3 best-effort (post-tx, come oggi).
6. Risposta `okMessage("Product deleted permanently")`.

### Endpoint bulk

#### `POST /seller/products/bulk/status`

```ts
const BulkStatusBody = t.Object({
  productIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }),
  status: t.Union(PRODUCT_STATUS.map((s) => t.Literal(s))),
});
const BulkResult = t.Object({
  succeeded: t.Array(t.String()),
  failed: t.Array(
    t.Object({
      productId: t.String(),
      reason: t.Union([t.Literal('not_found'), t.Literal('no_access')]),
    }),
  ),
});
```

Logica del service `bulkUpdateProductStatus`:

1. `withSeller`, `accessibleStoreIds`.
2. In transazione:
   - Carica tutti i prodotti richiesti che appartengono al seller E hanno almeno uno `store_products` in `accessibleStoreIds`. Filtro su `WHERE id = ANY($ids) AND seller_profile_id = $sp` + esistenza in `store_products`.
   - `succeeded` = ids tornati. `failed` = ids non tornati, con reason determinata da una seconda query mirata: se il prodotto esiste ma non accessible → `'no_access'`; se non esiste → `'not_found'`.
   - `UPDATE products SET status = $new, updated_at = now() WHERE id = ANY($succeeded_ids) AND status != $new RETURNING id, (SELECT status FROM products old WHERE old.id = products.id) as previous_status` — Postgres CTE o due passaggi.
   - In realtà più semplice: prima `SELECT id, status FROM products WHERE id = ANY($succeeded_ids)` per cogliere `previousStatus`, poi UPDATE, poi audit batch insert.
   - `recordProductAuditBatch(entries)` con un'entry per ciascun prodotto effettivamente cambiato (skip se `previousStatus === newStatus`).
3. Risposta `{ succeeded, failed }`.

#### `POST /seller/products/bulk/delete-permanent`

```ts
const BulkDeleteBody = t.Object({
  productIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }),
});
```

Reason categories: `'not_found' | 'no_access' | 'not_in_trash'`.

Logica:

1. Filtra come sopra. `failed` aggregato include anche chi non è in cestino (`status !== 'trashed'`).
2. Per i `succeeded`: carica le S3 keys delle immagini (singola query con `WHERE product_id = ANY($ids)`).
3. In transazione: `DELETE FROM products WHERE id = ANY($succeeded_ids)`.
4. Cleanup S3 best-effort fuori tx.
5. Log Pino per ciascun prodotto eliminato definitivamente (usa `pino.warn` aggregato o per ciascuno).
6. Risposta `{ succeeded, failed }`.

### List query — `GET /seller/products`

Estendi `validateSearch` esistente con `statusFilter`:

```ts
const ListQuery = t.Object({
  storeId: t.String(),
  page: t.Number({ default: 1 }),
  limit: t.Number({ default: 20 }),
  statusFilter: t.Union(
    PRODUCT_STATUS.map((s) => t.Literal(s)),
    { default: 'active' },
  ),
});
```

Service modifica: filtro `WHERE products.status = $statusFilter` invece di nulla. Default `'active'` mantiene il comportamento corrente per chi non passa il param.

### Counts per tab

Endpoint nuovo, leggero:

```ts
GET /seller/products/status-counts?storeId=...
→ 200 { active: number, disabled: number, trashed: number }
```

Una singola query: `SELECT status, COUNT(*) FROM products INNER JOIN store_products ON ... WHERE seller_profile_id = $sp AND store_id = $storeId GROUP BY status`. UI cachea con TanStack Query e invalida sulle mutation.

### Errore handling

Tutto via `ServiceError` + `withErrors()` come da pattern esistente. Niente try/catch per envelope shaping. Conflict 409 sul DELETE non-trashed gestito dal global handler con `ServiceError(409, ...)`.

### Auth e accessi

Macro `auth: true` su tutti gli endpoint, `withSeller(ctx)` per ricavare `sellerProfile`, `accessibleStoreIds` per il filtro multi-tenant. Niente cambiamenti di policy: stessi diritti owner/employee di oggi.

## Architettura — Frontend

### File nuovi/toccati

```
apps/seller/src/
├── routes/_authenticated/products/
│   └── index.tsx                          # MODIFICATO (tabs, checkbox, dropdown, bulk)
├── features/products/components/
│   ├── product-row-actions.tsx            # NUOVO — DropdownMenu per riga
│   ├── product-bulk-toolbar.tsx           # NUOVO — sticky toolbar bulk
│   ├── product-status-tabs.tsx            # NUOVO — Tabs con count
│   └── confirm-permanent-delete-dialog.tsx # NUOVO — AlertDialog
└── features/products/hooks/
    ├── use-product-mutations.ts           # NUOVO — wrappers TanStack Query con optimistic
    └── use-product-selection.ts           # NUOVO — hook stato selezione (Set di id)
```

### Struttura della route `/products`

Search params estesi:

```ts
validateSearch: (search) => ({
  page: Number(search.page ?? 1),
  limit: Number(search.limit ?? 20),
  statusFilter: (search.statusFilter as ProductStatus) ?? 'active',
})
```

Layout:

1. **Header** (invariato): titolo + breadcrumb + pulsante "Nuovo Prodotto".
2. **`ProductStatusTabs`**: tre tab `Attivi (N) | Disabilitati (N) | Cestino (N)`. Click aggiorna `statusFilter` nel URL (riusa `useNavigate` con search merge). Selezione si resetta al cambio tab.
3. **`ProductBulkToolbar`** (sticky, condizionale su `selectedIds.size > 0`): mostra count, pulsante "Annulla selezione", pulsanti azione context-aware sul tab.
4. **Tabella**: colonna checkbox in testa (header tristate via shadcn `Checkbox`), colonne dati invariate, colonna `ProductRowActions` in coda.
5. **Paginazione** invariata.

### Hook `useProductSelection`

```ts
function useProductSelection(currentPageIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return {
    selected,
    isSelected: (id: string) => selected.has(id),
    toggleOne: (id: string) => /* */,
    toggleAllOnPage: () => /* */,
    clear: () => setSelected(new Set()),
    headerCheckboxState: 'checked' | 'indeterminate' | 'unchecked',
  };
}
```

Reset automatico su cambio `statusFilter` (via `useEffect` che osserva il filter).

### Hook `useProductMutations`

Espone le mutation TanStack Query con optimistic updates per le azioni single. Pattern:

```ts
const setStatus = useMutation({
  mutationFn: ({ productId, status }) =>
    api().seller.products({ productId }).status.patch({ status }),
  onMutate: async ({ productId, status }) => {
    // optimistic: rimuovi dalla lista corrente se cambia tab,
    // o aggiorna in place se resta nello stesso filtro
  },
  onError: (err, vars, ctx) => {
    // rollback
    toast.error(...);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['product-status-counts'] });
  },
});
```

Le mutation bulk **non** sono optimistic: response best-effort, mostrano skeleton sulle righe selezionate e poi un toast riassuntivo `"3 disabilitati, 1 saltato (non accessibile)"`.

### Component `ProductRowActions`

Dropdown shadcn con voci context-aware:

| `statusFilter` | Voci |
|---|---|
| `active` | "Modifica" → `Link to="/products/$productId"` · "Disabilita" → `setStatus({ status: 'disabled' })` · "Sposta nel cestino" *(destructive)* → `setStatus({ status: 'trashed' })` |
| `disabled` | "Modifica" · "Riattiva" · "Sposta nel cestino" *(destructive)* |
| `trashed` | "Ripristina" → `setStatus({ status: 'active' })` · "Elimina definitivamente" *(destructive)* → apre `ConfirmPermanentDeleteDialog` |

Niente "Modifica" sul tab Cestino (un prodotto in cestino non si modifica; si ripristina prima).

### Component `ProductBulkToolbar`

Stessa struttura context-aware, applica le mutation bulk:

```tsx
{statusFilter === 'active' && (
  <>
    <Button onClick={bulkSetStatus('disabled')}>Disabilita</Button>
    <Button variant="destructive" onClick={bulkSetStatus('trashed')}>
      Sposta nel cestino
    </Button>
  </>
)}
{/* ... altri tab ... */}
```

`bulkSetStatus(target)` chiama `POST /bulk/status` con i `selectedIds`, in `onSuccess` invalida e clear della selezione. `bulkDeletePermanent` chiama `POST /bulk/delete-permanent` previo confirm dialog.

### Component `ConfirmPermanentDeleteDialog`

shadcn `AlertDialog`. Testo:

> **Eliminare definitivamente {N} prodotti?**
>
> Questa azione è irreversibile. Le immagini associate verranno cancellate. I tuoi ordini storici sono protetti e continueranno a mostrare il nome e i dettagli al momento dell'acquisto.

Action button `variant="destructive"`. Cancel button restituisce focus alla toolbar.

### Toast con "Annulla"

Per single-row status change: shadcn `Sonner` con `action: { label: 'Annulla', onClick: () => setStatus({ status: previousStatus }) }`. Durata 5s.

Non per delete-permanent (non reversibile per definizione).

Non per bulk: il toast bulk è puramente informativo (`"12 disabilitati, 2 saltati"`).

### i18n / messaggi

Tutte le stringhe attraverso Paraglide come da convenzione del progetto. Aggiungere chiavi a `apps/seller/messages/{it,en}.json`:
- `products.tabs.active`, `products.tabs.disabled`, `products.tabs.trashed`
- `products.actions.edit`, `products.actions.disable`, `products.actions.enable`, `products.actions.trash`, `products.actions.restore`, `products.actions.deletePermanent`
- `products.bulk.selected`, `products.bulk.clearSelection`
- `products.confirm.deletePermanent.title`, `products.confirm.deletePermanent.description`
- `products.toast.statusChanged`, `products.toast.undo`, `products.toast.bulkSummary`
- Empty states per i tre tab

### Eden Treaty

Tutti i nuovi endpoint sono automaticamente tipizzati. La `api()` del seller (`apps/seller/src/lib/api.ts`) si aggiorna senza cambiamenti. `bun run typecheck` da root convalida che non ci siano regressioni nelle altre app.

## Architettura — Test (apps/api)

Test obbligatori nel modulo seller (`apps/api/tests/`) coerenti con il pattern esistente:

- **`updateProductStatus`**: transizioni valide e no-op se stesso status; audit entry creato con action corretta; ownership check (404 per prodotto altrui o non accessibile).
- **`deleteProductPermanently`**: 409 se non in trash; 404 ownership; cleanup S3 invocato; cascata audit log → eliminato.
- **`bulkUpdateProductStatus`**: succeeded/failed correttamente categorizzati; audit batch consistente con il numero di succeeded; rispetto del cap 100.
- **`bulkDeletePermanent`**: failed include `not_in_trash`, `not_found`, `no_access`; S3 cleanup invocato per tutti i succeeded.
- **`product list`** con `statusFilter`: ritorna solo lo stato richiesto; default `'active'` se omesso.
- **`status-counts`**: somma corretta per il `storeId` richiesto.
- **`order checkout`** (regression): `orderItem` create dopo questa PR popolano correttamente i campi snapshot. Test che simula il flusso end-to-end del cart → order.

Niente test automatizzati su FE in questo scope.

## Migrazione

1. **`bun run db:generate`** dopo le modifiche schema. La migrazione SQL include:
   - `ALTER TABLE products ADD COLUMN status text NOT NULL DEFAULT 'active'`
   - `UPDATE products SET status = CASE WHEN is_active THEN 'active' ELSE 'disabled' END` (data migration)
   - `ALTER TABLE products DROP COLUMN is_active`
   - `ALTER TABLE products ADD CONSTRAINT product_status_valid CHECK (...)`
   - `DROP INDEX product_seller_ean_unique; CREATE UNIQUE INDEX ... WHERE ean IS NOT NULL AND status != 'trashed'`
   - `CREATE INDEX product_status_idx ON products(status)`
   - Per `order_items`: `ADD COLUMN product_name text NOT NULL DEFAULT ''` (poi backfill da `store_products → products → name`, poi `DROP DEFAULT` se vogliamo essere puliti); `ADD COLUMN product_ean text`, `brand_name text`, `product_image_url text`, `product_id text REFERENCES products(id) ON DELETE SET NULL`; `ALTER COLUMN store_product_id DROP NOT NULL`, drop FK e ricreala con `ON DELETE SET NULL`.
   - Backfill `order_items` dai prodotti correnti (best-effort: nome/EAN attuali; se in produzione fosse un sistema vivo questa sarebbe storia diversa, ma in dev va benissimo).
   - `CREATE TABLE product_audit_log (...)` con indici e check.
2. Apertura del file SQL generato e review prima di `bun run db:migrate`.
3. Seed riscritto (in `apps/api/src/db/seed/`) per popolare `status` invece di `isActive`.

## Verifica before completion

Coerente con `CLAUDE.md`:

- `bun run typecheck` — propaga via Eden Treaty ai 3 frontend; in particolare verifica che il customer non si sia rotto sul cambio `isActive → status`.
- `bun run lint` — Biome.
- `bun run --filter '@bibs/api' test` — copre i nuovi service e l'endpoint di checkout (regression snapshot).
- `bun run dev:seller` — esercitare a mano: creazione, disable, enable, trash, restore, delete permanent (single + bulk + edge case "Cestino vuoto"). Switch tab, verifica counts, verifica che `Annulla` del toast funzioni davvero.
- Verifica che `/openapi` riflette i nuovi endpoint.

## Out of scope (rivisto)

- UI di lettura del `product_audit_log`: registriamo, mostreremo dopo. La pagina dettaglio prodotto **non** mostra storico in questa PR.
- Cron di purge automatico del cestino dopo N giorni: per ora resta nel cestino indefinitamente. Decisione esplicita.
- Bulk operations su >100 IDs: la UI non lo permette. Caso futuro se necessario.
- Varianti di prodotto (taglie, colori): pre-esistente lacuna del modello, fuori scope.
- Audit log esteso (login, modifiche profilo, ecc.): solo prodotti in questa PR.
- Diff dei campi modificati nel `metadata` di action `'updated'`: opzionale, possiamo decidere in implementazione.

## Rischi & mitigazioni

| Rischio | Mitigazione |
|---|---|
| Backfill `order_items.product_name` fallisce su righe orfane (es. store_product cancellato manualmente) | Default `''` poi UPDATE join, poi (opzionale) costraint `CHECK (product_name <> '')`. In dev non c'è questo problema. |
| Regression sul checkout customer: dimentichiamo di popolare i campi snapshot | Test di integrazione end-to-end del flusso cart → order item, asserting tutti i campi snapshot popolati. Centralizzare in `buildOrderItemSnapshot` ridurre la superficie di errore. |
| Race condition: due employee bulk-trashano insieme gli stessi 50 prodotti | Best-effort già lo gestisce: il secondo riceve `succeeded` minore + `failed` con reason `'not_found'`. Audit log distingue le due azioni. Niente locking. |
| Concurrent edit: prodotto trash-ato mentre seller è in `/products/:id/edit` | La PATCH update fallirà al save (404 perché non più nel sellerProfile/store accessible? No, è ancora lì ma in cestino). **Da gestire**: il service di update accetta solo prodotti `status != 'trashed'`. 409 + messaggio "Prodotto nel cestino, ripristinalo prima". |
| Volumi grossi sul list query con tanti `disabled` | `index('product_status_idx')` copre il filtro. Pagination già presente. |
