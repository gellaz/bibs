# Seller — Store switcher, ruoli (titolare/impiegato) e refactor sidebar

**Data**: 2026-05-02
**Scope**: `apps/api`, `apps/seller`
**Out of scope**: `apps/admin`, `apps/customer`, modulo promozioni, real-time push

## Obiettivo

Trasformare l'app seller da multi-store con assegnazione esplicita prodotto→negozio a un'esperienza **store-scoped** in cui:

1. Lo **store-switcher in cima alla sidebar** seleziona il negozio attivo; tutta la navigazione operativa (prodotti, ordini, impostazioni negozio) lavora su quel negozio.
2. Esiste una **distinzione di ruolo** chiara tra **titolare** (owner) e **impiegato** (employee). Il titolare gestisce informazioni aziendali, negozi e team; l'impiegato lavora solo sul catalogo dei negozi a cui è stato assegnato.
3. Il titolare assegna ciascun impiegato a uno o più negozi (many-to-many). Gli impiegati esistono a livello azienda (team unico), ma vedono solo i negozi assegnati.
4. La sidebar è ridisegnata: voci "Profilo" e "Team" si spostano nel dropdown utente in fondo; "Negozi" diventa "Impostazioni negozio" scoped allo store attivo.
5. La pagina "Profilo" mostra dati personali (sempre) + informazioni aziendali (visibili a tutti, modificabili solo dal titolare).

Non è una nuova feature: è un refactor di IA + estensione ruoli + filtro store-scoped sui dati esistenti.

## Decisioni chiave (negoziate in brainstorming)

| Tema | Decisione |
|---|---|
| Modello dati prodotti | Restano a livello `sellerProfile`. Il filtro per negozio avviene via `store_products` (already exists). Creazione di un prodotto nello store attivo crea automaticamente la riga `store_products(productId, storeId, stock=0)`. Nessuna migrazione di dati prodotti. |
| Promozioni | **Out of scope** in questo lavoro. Verranno aggiunte in PR successiva con stesso pattern store-scoped. |
| Assegnazione employee↔store | Many-to-many via tabella `store_employee_stores`. Un impiegato può lavorare in N negozi; il titolare gestisce le assegnazioni. |
| Owner vs employee — accesso store | Owner ha accesso implicito a **tutti** gli store dell'azienda (non compare in `store_employee_stores`). Employee accede solo agli store presenti in `store_employee_stores` per il proprio `storeEmployeeId`. |
| Permessi employee sul catalogo | Pari diritti del titolare su prodotti, stock, immagini, ordini. **NON** può: modificare info aziendali (PATCH owner-only già esistente), aggiungere/modificare/eliminare negozi, gestire team. |
| Trasporto `activeStoreId` | LocalStorage (`bibs-seller-active-store`, già così) + query param `?storeId=...` sulle chiamate API store-scoped. **No** URL nested per store. **No** preferenza server-side. |
| Verifica server-side | Helper `ensureStoreAccess(storeId, ctx)` su ogni endpoint store-scoped. Owner: verifica appartenenza a `sellerProfile`. Employee: verifica presenza in `assignedStoreIds`. |
| IA sidebar | Header = `StoreSwitcher`. Nav = Home / Prodotti / Impostazioni negozio. Footer = `NavUser` arricchito (Profilo + Team + Theme + Locale + Logout). |
| Voce "Negozi" (lista globale) | **Eliminata.** Modifica del negozio attivo via `/store`; aggiunta nuovo negozio via dropdown dello switcher (owner-only). |
| Pagina Profilo | Due card stacked: "Profilo personale" (sempre) + "Informazioni aziendali" (visibile a tutti, editabile solo owner). |
| Editabilità info aziendali | Free edit su ragione sociale / forma giuridica / indirizzo (PATCH `/settings/company`). P.IVA read-only con bottone "Richiedi cambio P.IVA" (PATCH `/settings/vat` → `seller_profile_change` pending). Already-existing distinction. |
| Invito collaboratore con preselezione store | Al momento dell'invito il titolare seleziona già i negozi (multi-checkbox, ≥1 obbligatorio). Le selezioni vengono propagate alle assegnazioni quando l'invito è accettato. |
| Empty state employee con 0 negozi | Pagina dead-end "Nessun negozio assegnato — contatta il titolare" + bottone Logout. Nessuna sidebar, nessun outlet. |
| Centralizzazione check ruolo | Hook `useIsOwner()` in `apps/seller/src/hooks/`. Migra usi sparsi di `session?.user.role === "seller"`. |

## Architettura — Schema DB

### Tabella nuova: `store_employee_stores`

`apps/api/src/db/schemas/employee.ts`:

```ts
export const storeEmployeeStores = pgTable(
  "store_employee_stores",
  {
    storeEmployeeId: text("store_employee_id")
      .notNull()
      .references(() => storeEmployee.id, { onDelete: "cascade" }),
    storeId: text("store_id")
      .notNull()
      .references(() => store.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.storeEmployeeId, t.storeId] }),
    index("store_employee_stores_store_id_idx").on(t.storeId),
  ],
);

export const storeEmployeeStoresRelations = relations(storeEmployeeStores, ({ one }) => ({
  storeEmployee: one(storeEmployee, {
    fields: [storeEmployeeStores.storeEmployeeId],
    references: [storeEmployee.id],
  }),
  store: one(store, {
    fields: [storeEmployeeStores.storeId],
    references: [store.id],
  }),
}));
```

Estendere `storeEmployeeRelations` per esporre `storeAssignments: many(storeEmployeeStores)`.

### Tabella nuova: `employee_invitation_stores`

`apps/api/src/db/schemas/employee-invitation.ts`:

```ts
export const employeeInvitationStores = pgTable(
  "employee_invitation_stores",
  {
    invitationId: text("invitation_id")
      .notNull()
      .references(() => employeeInvitation.id, { onDelete: "cascade" }),
    storeId: text("store_id")
      .notNull()
      .references(() => store.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.invitationId, t.storeId] }),
    index("employee_invitation_stores_store_id_idx").on(t.storeId),
  ],
);
```

Più relations corrispondenti, con `employeeInvitationRelations` esteso.

### Re-export

`apps/api/src/db/schemas/index.ts`: aggiungere export per le due nuove tabelle e relations.

### Migration

`bun run db:generate` produrrà la migration con i due `CREATE TABLE`. Verificare il SQL prima di `db:migrate`. Niente backfill di dati: tabelle nuove e vuote.

## Architettura — API (Elysia)

### Estensione `apps/api/src/modules/seller/context.ts`

Aggiungere helper a `SellerResolvedContext`:

```ts
export interface SellerResolvedContext {
  // ...existing
  /** Lazy: tutti gli store accessibili al chiamante (owner: tutti dell'azienda; employee: solo assegnati). */
  getAccessibleStoreIds: () => Promise<string[]>;
}

export async function getEmployeeAssignedStoreIds(
  userId: string,
  sellerProfileId: string,
): Promise<string[]> {
  // SELECT ses.store_id
  // FROM store_employee_stores ses
  // JOIN store_employees e ON e.id = ses.store_employee_id
  // WHERE e.user_id = $1 AND e.seller_profile_id = $2 AND e.status = 'active'
}

/**
 * Verifica che il chiamante abbia accesso allo store. Owner: ensureStoreOwnership.
 * Employee: 403 se storeId non in assignedStoreIds.
 */
export async function ensureStoreAccess(
  storeId: string,
  ctx: SellerResolvedContext,
): Promise<void>;
```

Wirare `getAccessibleStoreIds` nel `.resolve()` del seller guard, lazy come `getStoreIds` esistente.

### Endpoint nuovi (`apps/api/src/modules/seller/routes/employees.ts`)

```
GET  /seller/employees/:employeeId/stores        → { data: Store[] }       (owner-only)
PUT  /seller/employees/:employeeId/stores        → { data: Store[] }       (owner-only)
                                                  body: { storeIds: string[] }  (idempotente: REPLACE)
```

Il PUT esegue in transazione `DELETE FROM store_employee_stores WHERE store_employee_id = $1` + `INSERT INTO store_employee_stores ...`. Verifica che ogni `storeId` appartenga al `sellerProfileId` corrente (404 altrimenti).

### Endpoint modificati

| Endpoint | Modifica |
|---|---|
| `POST /seller/employees/invite` | Body: `{email, storeIds: string[]}` con `minItems: 1`. Service crea `employee_invitations` + N righe in `employee_invitation_stores` in transazione. |
| `GET /seller/employees` | Response include `storeIds: string[]` per ogni dipendente (denormalizzato). Schema: `EmployeeWithUserSchema` aggiunge `storeIds: t.Array(t.String())`. |
| `GET /seller/employees/invitations` | Response include `storeIds: string[]` per ogni invito. |
| `GET /seller/products` | Query param `storeId: string` (obbligatorio). Filtra via `INNER JOIN store_products ON sp.product_id = p.id AND sp.store_id = $storeId`. `ensureStoreAccess` precede la query. |
| `POST /seller/products` | Body include `storeId: string`. Crea il prodotto + `store_products(productId, storeId, stock=0)` in transazione. `ensureStoreAccess`. |
| `GET /seller/products/:productId`, `PATCH ...`, `DELETE ...` | Verificano che il prodotto sia disponibile in almeno uno degli `accessibleStoreIds` del chiamante. 404 se non lo è (no leak). |
| `GET /seller/stock`, `POST /seller/stock` | Già store-scoped. Aggiungere `ensureStoreAccess`. |
| `GET /seller/orders` | Query param `storeId`. `ensureStoreAccess`. |
| `GET /seller/stores` | Owner: tutti i negozi non-deleted. Employee: solo accessibili. |
| `POST /seller/stores`, `PATCH /seller/stores/:id`, `DELETE /seller/stores/:id` | Già protetti da `requireOwner` (verificato: `routes/stores.ts:45,77,169`). Nessun cambio. |
| `GET /seller/settings` | Response include `assignedStoreIds: string[] \| null` (null = owner = tutti). |

### Acceptance flow invito

`apps/api/src/modules/registration/services.ts` (riga ~107-156): nella transazione che crea `storeEmployee` dall'invito, leggere `employee_invitation_stores` per `invitation.id` e inserire le righe corrispondenti in `store_employee_stores(storeEmployeeId, storeId)`. Filtrare per store ancora esistenti (FK cascade gestisce gli eliminati: la riga sparisce automaticamente, l'INSERT è no-op silenzioso).

### Schemi (`apps/api/src/lib/schemas/`)

- `EmployeeWithUserSchema`: + `storeIds: t.Array(t.String())`.
- `EmployeeInvitationSchema`: + `storeIds: t.Array(t.String())`.
- `TeamInviteBody`: + `storeIds: t.Array(t.String(), { minItems: 1 })`.
- Schema response per `GET /employees/:id/stores` e `PUT /employees/:id/stores`: array di Store minimal (id, name, city, province).
- `SellerSettingsSchema` (response di `GET /settings`): + `assignedStoreIds: t.Union([t.Array(t.String()), t.Null()])`.

### Errori

- `ensureStoreAccess` lancia `ServiceError(403, "Accesso negato a questo negozio")`.
- `requireOwner` come oggi → 403 `"Only store owners can perform this action"`.
- Prodotto non accessibile o inesistente → 404 unificato.

## Architettura — Frontend seller (TanStack Start)

### Sidebar

`apps/seller/src/components/app-sidebar.tsx` ridisegnata:

```
<Sidebar collapsible="icon">
  <SidebarHeader>
    <StoreSwitcher />
  </SidebarHeader>

  <SidebarContent>
    <SidebarGroup>
      <SidebarGroupLabel>Navigazione</SidebarGroupLabel>
      <SidebarMenu>
        <Link to="/">Home</Link>
        <Link to="/products">Prodotti</Link>
        <Link to="/store">Impostazioni negozio</Link>
      </SidebarMenu>
    </SidebarGroup>
  </SidebarContent>

  <SidebarFooter>
    <NavUser />
  </SidebarFooter>
</Sidebar>
```

### `StoreSwitcher` (estensione)

`apps/seller/src/components/store-switcher.tsx`:

- Trigger: come oggi (logo store + nome + città + chevron).
- Dropdown:
  - Sezione "Negozi" — lista degli store accessibili con check sul corrente.
  - Separator.
  - Item "Modifica negozio attivo" → `<Link to="/store">`.
  - Item "+ Aggiungi negozio" → `<Link to="/store/new">`. **Visibile solo se `useIsOwner()`**.
- Comportamento con 1 solo store: il dropdown è **sempre apribile** (sia owner che employee), per uniformità UX. Owner vede "+ Aggiungi negozio" + "Modifica negozio attivo"; employee vede solo "Modifica negozio attivo" (e accederà alla pagina in read-only). Il branch single-store dell'attuale `store-switcher.tsx` (riga 26-45) viene rimosso.

### `NavUser` (arricchito)

`apps/seller/src/components/nav-user.tsx`: il dropdown contiene:

```
[Avatar] Marco Rossi
         marco@…
─────────────────
👤 Profilo            (link /profile)
👥 Team               (link /team, owner-only via useIsOwner)
─────────────────
[☀ tema] [🌐 lingua]
─────────────────
🚪 Esci
```

### `CompanyHeader`

Eliminato. La ragione sociale appare nella card "Informazioni aziendali" del Profilo, non più in sidebar.

### Hook `useIsOwner`

`apps/seller/src/hooks/use-is-owner.ts`:

```ts
import { authClient } from "@/lib/auth-client";

export function useIsOwner(): boolean {
  const { data: session } = authClient.useSession();
  return session?.user.role === "seller";
}
```

Migrare gli usi sparsi di `session?.user.role === "seller"` in tutto `apps/seller/src/`. (L'unico uso oggi è in `stores/index.tsx:31`, file che viene comunque eliminato — ma il refactor di centralizzazione vale come pattern per i futuri usi nelle nuove pagine `store/index.tsx`, `team`, `profile`, `nav-user`, `store-switcher`.)

### `useActiveStore`

`apps/seller/src/hooks/use-active-store.tsx`: nessun cambio strutturale. Continua a leggere `useStores()`, gestire localStorage, auto-selezionare il primo store. La validazione "store ancora accessibile" è già implicita perché `useStores()` ritorna solo gli store accessibili lato server.

### Hook nuovi

- `apps/seller/src/hooks/use-products.ts`:
  ```ts
  export function useProducts(storeId: string | null, page = 1, limit = 50) {
    return useQuery({
      queryKey: ["products", storeId, page, limit],
      queryFn: async () => api().seller.products.get({ query: { storeId, page, limit } }),
      enabled: storeId !== null,
    });
  }
  ```
- `apps/seller/src/hooks/use-employee-stores.ts`: query/mutation per `GET/PUT /employees/:id/stores`.

### Route nuove

- `src/routes/_authenticated/store.tsx` (layout `<Outlet />`).
- `src/routes/_authenticated/store/index.tsx` — info dello store attivo. Riusa `store-form.tsx`. Per owner: editabile, submit `PATCH /seller/stores/:storeId`. Per employee: form con tutti i campi `disabled`, niente bottone "Salva".
- `src/routes/_authenticated/store/new.tsx` — form creazione. `beforeLoad` redirect se non `useIsOwner()`. Submit `POST /seller/stores`. Sul successo: setActiveStoreId al nuovo id e redirect a `/`.

### Route eliminate

- `src/routes/_authenticated/stores.tsx`
- `src/routes/_authenticated/stores/index.tsx`
- `src/routes/_authenticated/stores/new.tsx`
- `src/routes/_authenticated/stores/$storeId/...`

### `_authenticated.tsx` — empty state employee

Dopo il check role/onboarding, se `role === "employee"` e `stores.length === 0`:

```
<div className="flex h-screen flex-col items-center justify-center gap-4">
  <h1 className="text-2xl font-bold">Nessun negozio assegnato</h1>
  <p className="text-muted-foreground">
    Non sei ancora assegnato a nessun negozio. Contatta il titolare per ottenere l'accesso.
  </p>
  <Button variant="outline" onClick={signOut}>Esci</Button>
</div>
```

Nessuna sidebar, nessun outlet renderizzato.

### Pagina Profilo

`src/routes/_authenticated/profile.tsx`:

```tsx
function ProfilePage() {
  const isOwner = useIsOwner();
  return (
    <div className="space-y-4 max-w-md">
      <PersonalInfoCard />
      <BusinessInfoCard readOnly={!isOwner} />
    </div>
  );
}
```

- `<PersonalInfoCard />`: form esistente (firstName/lastName/birthDate). Nessun cambio funzionale.
- `<BusinessInfoCard readOnly={...} />`:
  - Bind a `useSellerSettings()` (dati `organization`).
  - Campi free-edit (visibili a tutti, editable solo se !readOnly): ragione sociale, forma giuridica, indirizzo (line1/CAP/città/provincia/paese).
  - Campo P.IVA: sempre `disabled`. Per owner accanto un bottone "Richiedi cambio P.IVA" che apre un dialog/modal con form `vatNumber` → `PATCH /seller/settings/vat`.
  - Submit "Salva modifiche" su `PATCH /seller/settings/company`. Hidden per employee.

### Pagina Team

`src/routes/_authenticated/team/index.tsx` estesa:

- Tabella dipendenti: aggiunge colonna "Negozi" che mostra i `storeIds` come chip (popolati dal nome dello store via `useStores()` lookup map). Empty: "Nessun negozio" testo grigio.
- Vicino ai chip: icona/pulsante "Modifica" che apre dialog `<EmployeeStoresDialog employeeId={...} />`.
- Dialog: multi-checkbox di tutti gli store dell'azienda. Submit → mutation che chiama `PUT /employees/:id/stores`. Invalidate `["employees", ...]`.
- Dialog "Invita collaboratore":
  - Input email (esistente).
  - **Nuovo**: multi-checkbox "Negozi a cui assegnare" (≥1 richiesto, validation client + server).
  - Submit a `POST /employees/invite` con `{email, storeIds}`. Invalidate `["employees", "invitations"]`.
- Sezione "Inviti pendenti": mostra i chip degli store preselezionati.
- Riga titolare in cima: usa il campo `owner` già ritornato da `GET /employees`. Badge "Titolare", colonna Negozi: "Tutti i negozi" testo informativo, niente azioni.

### Pagina Prodotti

`src/routes/_authenticated/products/index.tsx`:

- Header: `<h1>Prodotti — {activeStore.name}</h1>` + bottone "+ Crea prodotto" linka a `/products/new`.
- Lista: usa `useProducts(activeStore.id)`. Tabella con stock specifico per il negozio attivo (dal `storeProduct` filtrato).
- Empty state: "Nessun prodotto in {activeStore.name}. Inizia ad aggiungere prodotti al catalogo di questo negozio."

`src/routes/_authenticated/products/new.tsx`:

- Form `<ProductForm />` esistente. Submit include `storeId: activeStore.id`. Toast "Prodotto creato in {activeStore.name}".

`src/features/products/components/product-form.tsx`:

- Submit handler aggiunge `storeId` dal context (prop o `useActiveStore` direttamente).

### `store-inventory.tsx`

Componente esistente in `apps/seller/src/features/stores/components/store-inventory.tsx`. Era usato dalla pagina `/stores/$storeId` (eliminata). La gestione stock per-store ora vive direttamente nella tabella prodotti di `/products` (lo stock mostrato è quello del negozio attivo, modificabile inline). **Decisione**: eliminare il file; se al momento dell'implementazione emerge una funzionalità non coperta dalla nuova `/products` la si reimplementa nella sede giusta, ma non ricicliamo questo componente.

### i18n

Nuove chiavi in `apps/seller/messages/*.json` (Italian + tutte le locali supportate):
- empty state employee senza store
- testo "Nessun negozio" / "Tutti i negozi" / "Modifica assegnazioni"
- titoli dialog "Invita collaboratore" / "Assegna negozi a {name}"
- empty state prodotti per negozio
- toast "Accesso negato a questo negozio"
- copy "Richiedi cambio P.IVA"

Convenzione: chiavi nuove sotto namespace coerenti (`team.*`, `profile.*`, `products.*`).

## Casi limite

| Scenario | Comportamento |
|---|---|
| Owner con 0 negozi (post-onboarding raro) | Empty state "Crea il tuo primo negozio" + CTA `+ Crea negozio`. Switcher nascosto. |
| Employee con 0 negozi assegnati | Empty state dead-end (vedi sopra), nessuna sidebar. |
| `activeStoreId` in localStorage non più valido | `ActiveStoreProvider` auto-seleziona il primo store accessibile (logica esistente). |
| Owner elimina ultimo negozio | Soft-delete (`deletedAt`). Lista `useStores()` non lo mostra più. Switcher torna a empty state. |
| Owner de-assegna employee da unico negozio mentre online | Al prossimo refetch di `useStores()`, l'employee finisce nell'empty state. **No real-time push.** |
| URL manipolato per accedere a storeId non assegnato | Backend `ensureStoreAccess` ritorna 403. Frontend: toast "Accesso negato" + redirect `/`. |
| Invito accettato con store eliminato fra invio e accept | Cascade FK rimuove la riga in `employee_invitation_stores`. Acceptance: insert no-op per quella riga. |
| Invito a email già invitata pending | Backend ritorna 409 (unique partial index). Toast: "Esiste già un invito per questa email". |
| Modifica `storeIds` su invito pending | Out of scope. Cancel invito + reinvio. |

## Testing

### Backend

- Test esistenti su `seller/services/employees.ts`: estendere coverage per assegnazioni/invito con stores.
- Nuovi test:
  - `getEmployeeAssignedStoreIds` ritorna union via JOIN corretto.
  - `ensureStoreAccess` autorizza owner sempre, employee solo se assegnato.
  - `PUT /employees/:id/stores` idempotente (replace funziona, ordine non conta).
  - Acceptance invito propaga `storeIds` correttamente, ignorando store eliminati.
  - `GET /products?storeId=X` filtra correttamente; tentativi senza `storeId` → 400; con `storeId` non accessibile → 403.
  - `POST /products` con `storeId` crea anche il `store_products`.

### Frontend smoke (browser)

Avviare i dev server e verificare:

1. **Owner con 1 store**: lo switcher mostra il negozio, dropdown apribile con "+ Aggiungi negozio".
2. **Owner con 2+ store**: switcher cambia contesto; lista prodotti aggiornata; cache separata.
3. **Owner crea prodotto**: appare solo nello store attivo. Switch → non visibile in altri.
4. **Owner assegna employee a store A solo**: login come employee, vede solo A. Switch impossibile.
5. **Owner de-assegna**: employee al refresh finisce in empty state.
6. **Owner edita info aziendali**: free-edit funziona; cambio P.IVA crea `seller_profile_change`.
7. **Employee apre Profilo**: vede entrambe le card, info aziendali read-only, nessun bottone "Salva".
8. **Employee invitato con preselezione store**: dopo accept, ha già accesso ai negozi giusti senza intervento del titolare.

### Verifiche pre-merge

- `bun run typecheck` (root, propaga su 3 frontend + api).
- `bun run lint` (Biome).
- `bun run test` (api).
- `bun run db:generate` → review SQL → `bun run db:migrate`.
- Apertura `/openapi`: nuovi endpoint documentati con `summary` e `description` italiani.

## Out of scope (esplicito)

- Modulo promozioni (PR successiva, stesso pattern store-scoped).
- Storage server-side dell'`activeStoreId` (preferenza utente sincronizzata fra device).
- Real-time push del de-assegnamento o ban.
- Azione "Duplica prodotto in altro negozio" (per ora se serve si crea due volte).
- Ruoli granulari per employee (es. employee read-only stock, employee no-delete prodotti). Resta tutto-o-niente.
- Modifica `storeIds` su invito pending (workaround: cancel + reinvio).
- Refactor di `apps/admin` o `apps/customer`.

## Lista file toccati (riepilogo)

### Backend (`apps/api/`)

- `src/db/schemas/employee.ts` — nuova tabella `storeEmployeeStores` + relations
- `src/db/schemas/employee-invitation.ts` — nuova tabella `employeeInvitationStores` + relations
- `src/db/schemas/index.ts` — re-export
- `src/db/migrations/<auto>` — generata
- `src/modules/seller/context.ts` — `getAccessibleStoreIds`, `ensureStoreAccess`, `getEmployeeAssignedStoreIds`
- `src/modules/seller/routes/employees.ts` — body invito con `storeIds`, nuovi `GET/PUT /employees/:id/stores`
- `src/modules/seller/services/employees.ts` — logica assegnazione + invito con stores
- `src/modules/seller/routes/products.ts` + `services/products.ts` — query `storeId`, body `storeId`
- `src/modules/seller/routes/stock.ts` + `services/stock.ts` — `ensureStoreAccess`
- `src/modules/seller/routes/orders.ts` + `services/orders.ts` — query `storeId`
- `src/modules/seller/routes/stores.ts` + `services/stores.ts` — verifica owner-only su mutation; filtro accessibili su GET
- `src/modules/seller/routes/settings.ts` — `assignedStoreIds` nella response GET
- `src/modules/registration/services.ts` — accept invitation propaga `storeIds`
- `src/lib/schemas/` — `EmployeeWithUserSchema`, `EmployeeInvitationSchema`, `TeamInviteBody`, `SellerSettingsSchema`

### Frontend seller (`apps/seller/`)

- `src/components/app-sidebar.tsx` — rimuove Negozi/Profilo/Team, aggiunge Impostazioni negozio
- `src/components/store-switcher.tsx` — header position, dropdown con "+ Aggiungi negozio" e "Modifica"
- `src/components/nav-user.tsx` — aggiunge Profilo + Team (owner-only)
- `src/components/company-header.tsx` — eliminato
- `src/hooks/use-is-owner.ts` — nuovo
- `src/hooks/use-products.ts` — nuovo (con `storeId`)
- `src/hooks/use-employee-stores.ts` — nuovo
- `src/routes/_authenticated.tsx` — empty state employee senza negozi
- `src/routes/_authenticated/profile.tsx` — aggiunge `<BusinessInfoCard>`
- `src/routes/_authenticated/team/index.tsx` — colonna Negozi, dialog assegnazione, invito con stores
- `src/routes/_authenticated/store.tsx` (nuovo) + `store/index.tsx` (nuovo) + `store/new.tsx` (nuovo)
- `src/routes/_authenticated/stores*` — eliminati
- `src/routes/_authenticated/products/{index,new,$productId}.tsx` — usano `useProducts(activeStoreId)`
- `src/features/products/components/product-form.tsx` — passa `storeId` in submit
- `src/features/stores/components/store-inventory.tsx` — eliminabile (verificare)
- `messages/*.json` — nuove chiavi i18n
