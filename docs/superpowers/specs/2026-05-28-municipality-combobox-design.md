# Municipality Combobox — Design

**Data**: 2026-05-28
**Stato**: Approvato in brainstorming, pronto per writing-plans
**Owner**: Marco Gelli

---

## 1. Contesto

Oggi nei form bibs il comune italiano è raccolto come stringa libera (`city: text`) accanto a una sigla provincia 2-char (`province: text`). Le righe sono libere da vincoli di dominio: un seller può scrivere `Milnao` o `mi` senza che il sistema lo intercetti. La tabella `municipality` (~7.890 righe, FK → `province` → `region`) esiste già nello schema Drizzle ed è popolata dal seed `apps/api/src/db/seed/base/`, ma non è referenced da nessuna tabella business.

Obiettivo: sostituire ovunque la coppia testuale `city`/`province` con una FK `municipalityId` verso `municipality(id)`, esposta in UI da un Combobox dedicato che cerca tra tutti i comuni italiani.

## 2. Decisioni di fondo (dal brainstorming)

| Tema | Scelta |
|---|---|
| Data model | Full FK migration. `municipalityId: uuid NOT NULL` ovunque (eccezioni nullable solo dove oggi `residenceCity` è nullable). |
| Backfill | Nessuno. App in dev, seed riscritto da zero. |
| UX flow | Combobox unico su tutta Italia. Niente cascaded "Provincia → Comune". |
| Search | Client-side. Precarica tutti i ~7.900 comuni una volta per sessione, ricerca in memoria. |
| Geo scope | Italia-only. Niente toggle "altro paese". |
| Provincia in UI | Rimossa come campo separato. Sigla mostrata inline nell'item del Combobox e nel trigger come `Nome (XX)`. |
| `zipCode` | Resta campo separato (un comune ha N CAP). |

## 3. Architettura

```
┌─────────────────────────────────────────────────────────────┐
│ apps/api                                                    │
│                                                             │
│  GET /locations/municipalities/all                          │
│    → { data: [{ id, name, provinceAcronym }] }             │
│    → cache HTTP 24h + ETag                                  │
│                                                             │
│  Schema DB:                                                 │
│    organization, store, customerAddress, sellerProfile      │
│    ─→ FK municipality_id uuid → municipality(id)            │
└─────────────────────────────────────────────────────────────┘
                          │
                          │  Eden Treaty (3 client)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ apps/seller (admin/customer: stesso pattern quando serve)   │
│                                                             │
│  src/lib/hooks/use-municipalities.ts                        │
│    → useQuery(['municipalities','all'], staleTime:Infinity) │
│                                                             │
│  src/routes/.../onboarding/company.tsx                      │
│  src/features/stores/components/store-form.tsx              │
│  src/features/profile/components/business-info-card.tsx     │
│    → <Controller name="municipalityId">                     │
│        <MunicipalityCombobox value onChange municipalities/>│
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │  import @bibs/ui
                          │
┌─────────────────────────────────────────────────────────────┐
│ packages/ui                                                 │
│                                                             │
│  src/components/municipality-combobox.tsx                   │
│    → pure UI sopra Combobox (@base-ui/react)                │
│    → riceve `municipalities` come prop                      │
│    → filter normalizzato (deburr) + cap 50 visibili         │
└─────────────────────────────────────────────────────────────┘
```

## 4. Backend

### 4.1 Endpoint nuovo

**Path**: `GET /locations/municipalities/all`
**Auth**: pubblico (come gli altri `/locations/*`).
**Query params**: nessuno.
**Response**:

```ts
{
  data: Array<{
    id: string            // uuid
    name: string          // "Milano"
    provinceAcronym: string  // "MI", 2 char
  }>
}
```

**Comportamento**:
- `ORDER BY name ASC` deterministico.
- INNER JOIN su `province` per leggere `acronym`.
- Cache HTTP: `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`. Niente ETag — `staleTime: Infinity` lato TanStack Query rende la rivalidazione conditional un'ottimizzazione marginale, e nessun altro endpoint del repo introduce ETag (eviterebbe un pattern one-off).

**Service** (`apps/api/src/modules/locations/services/locations.ts`): nuovo metodo `listAllMunicipalities(db)`. Una sola select+join, niente count.

**Route** (`apps/api/src/modules/locations/routes/locations.ts`): aggiungere `.get('/municipalities/all', …)` con response schema TypeBox e `description` OpenAPI in italiano coerente con il resto della spec.

**Endpoint esistente paginato** (`GET /locations/municipalities?provinceId=…&page=…&limit=…`): non viene toccato. Continua a servire eventuali viste paginate (admin tooling).

### 4.2 Schema DB: migration

Tabelle toccate:

| Tabella (file) | Drop | Add |
|---|---|---|
| `organization` (`apps/api/src/db/schemas/organization.ts`) | `city`, `province` | `municipality_id uuid NOT NULL` |
| `store` (`apps/api/src/db/schemas/store.ts`) | `city`, `province` | `municipality_id uuid NOT NULL` |
| `customerAddress` (`apps/api/src/db/schemas/address.ts`) | `city`, `province` | `municipality_id uuid NOT NULL` |
| `sellerProfile` (`apps/api/src/db/schemas/seller.ts`) | `residence_city`, `document_issued_municipality` | `residence_municipality_id uuid NULL`, `document_issued_municipality_id uuid NULL` |

Tutte FK con `ON DELETE RESTRICT` (vietiamo orfani — un comune non si cancella senza ripuliture). Indice B-tree singolo sulla nuova colonna FK in ogni tabella.

`zipCode`/`residenceZipCode` restano com'erano (non legati a `municipality`: un comune ha più CAP).

Workflow: `bun run db:generate` → review SQL → `bun run db:migrate`. Niente `db:push`.

### 4.3 Schemi forms (TypeBox)

`apps/api/src/lib/schemas/forms/`:

- `onboarding.ts`
  - `CompanyBody`: drop `city`/`province`, add `municipalityId: t.String({ format: 'uuid', description: 'ID del comune della sede legale' })`.
  - `DocumentBody`: drop `documentIssuedMunicipality`, add `documentIssuedMunicipalityId: t.String({ format: 'uuid', description: 'ID del comune di emissione del documento' })`.
- `settings.ts`: stesse modifiche su `CompanySettingsBody` e `DocumentChangeBody`.
- `stores.ts`: `CreateStoreBody` → drop `city`/`province`, add `municipalityId`.

`zipCode` invariato (`t.String({ pattern: '^\\d{5}$' })`).

### 4.4 Service layer

Tutti i service che oggi leggono/scrivono `city`/`province` su `organization`, `store`, `customerAddress`, `sellerProfile`:

- **Write path**: persistono `municipality_id`. Niente altro.
- **Read path** (GET singolo o lista): JOIN con `municipality` + `province`, esponendo nel response shape un oggetto annidato:

  ```ts
  municipality: {
    id: string
    name: string
    provinceAcronym: string
  }
  ```

  I response schema delle route corrispondenti aggiornano la propria definition di conseguenza, così Eden Treaty propaga il nuovo tipo ai 3 frontend.

### 4.5 Seed

- L'array hardcoded `cities` in `apps/api/src/db/seed/fixtures/utils.ts` (linee 110–429) viene eliminato.
- Le fixture (`sellers.ts`, `dev-seller.ts`) ricevono `municipalityId` reali pescati da `municipality` già seedata in `base/`. Strategia: una helper `pickRandomMunicipality(db)` o (preferito per determinismo) un set fisso di ~10 UUID di comuni reali noti (Milano, Roma, Torino, Bologna, ecc.) referenziati per ISTAT code.
- `dev-seller.ts` hardcoded a Milano: lookup per `istatCode = '015146'` (Milano).

## 5. Frontend

### 5.1 Componente `MunicipalityCombobox`

File: `packages/ui/src/components/municipality-combobox.tsx`.

**Props**:

```tsx
type MunicipalityOption = { id: string; name: string; provinceAcronym: string }

type MunicipalityComboboxProps = {
  value: string | null
  onChange: (id: string | null) => void
  municipalities: MunicipalityOption[] | undefined  // undefined = loading
  loading?: boolean
  error?: boolean
  placeholder?: string           // default "Cerca comune…"
  disabled?: boolean
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}
```

Niente multiselect. Niente "create new".

**Costruito su**: `Combobox` esistente in `packages/ui/src/components/combobox.tsx` (wrapper `@base-ui/react`). Riusa `Root`, `Input`, `Trigger`, `Content`, `List`, `Item`, `Empty`.

**Render**:
- Item: stringa singola `Nome (XX)` (es. `Milano (MI)`).
- Trigger (selezionato): `Nome (XX)`.
- Trigger (placeholder): `Cerca comune…`.

**Filter logic**:
1. Normalize: lowercase + deburr via `.normalize('NFD').replace(/\p{Diacritic}/gu, '')`. Niente nuove dep.
2. Build searchable string = `${nameNormalized} (${acronymLower})`. Permette match indiretto via sigla (`(mi` → Milano).
3. Match: `startsWith(q)` ha priorità su `includes(q)`.
4. Sort: priorità (0=startsWith, 1=includes) → poi alfabetico.
5. Cap visibili a **50**. Footer muted `… altri N risultati, raffina la ricerca` se total > 50.
6. Query vuota: primi 50 comuni alfabetici.

**Stati**:
- `municipalities === undefined && loading`: trigger disabled, placeholder "Caricamento comuni…", spinner inline.
- `error === true`: trigger disabled, testo "Impossibile caricare i comuni". L'app wrapper può triggerare retry (TanStack Query retry auto).
- `value` non risolvibile in cache: trigger mostra placeholder + `console.warn` dev-only, non rompe.

**A11y**: `aria-invalid`, `aria-describedby` pass-through. Keyboard navigation garantita da Base UI. Label esterno via `<Label htmlFor>` dal form.

### 5.2 Hook per app

`apps/seller/src/lib/hooks/use-municipalities.ts`:

```ts
export const municipalitiesQueryOptions = () =>
  queryOptions({
    queryKey: ['municipalities', 'all'] as const,
    queryFn: async () => {
      const { data, error } = await api.locations.municipalities.all.get()
      if (error) throw error
      return data.data
    },
    staleTime: Infinity,
    gcTime: Infinity,
  })

export function useMunicipalities() {
  return useQuery(municipalitiesQueryOptions())
}
```

Pattern identico replicabile in `apps/admin` e `apps/customer` quando il componente arriverà lì.

### 5.3 Integrazione react-hook-form

```tsx
<Controller
  control={form.control}
  name="municipalityId"
  render={({ field, fieldState }) => (
    <MunicipalityCombobox
      value={field.value ?? null}
      onChange={field.onChange}
      municipalities={data}
      loading={isLoading}
      aria-invalid={!!fieldState.error}
    />
  )}
/>
```

### 5.4 Form da riscrivere

Tutti e tre nell'app `seller`:

1. **`apps/seller/src/routes/_authenticated/onboarding/company.tsx`** (linee 132–158)
   Rimuovere i 3 input city/province. Mantenere `zipCode`. Aggiungere `<MunicipalityCombobox>` controlled tramite `municipalityId`.

2. **`apps/seller/src/features/stores/components/store-form.tsx`** (linee 199–239)
   Stesso pattern.

3. **`apps/seller/src/features/profile/components/business-info-card.tsx`** (linee 143–169)
   Stesso pattern.

`apps/admin` e `apps/customer`: oggi non hanno form che selezionano comune. Niente da toccare ora — il componente è pronto quando arriveranno.

### 5.5 Prefetch

Per evitare flash "Caricamento comuni…" al primo render del form, le route che includono il Combobox usano il loader TanStack Router:

```ts
export const Route = createFileRoute('...')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(municipalitiesQueryOptions()),
  component: …,
})
```

### 5.6 i18n

Aggiornare `apps/seller/messages/it.json` (e `en.json` se esiste) con le nuove chiavi:

- `municipality.label` = "Comune"
- `municipality.placeholder` = "Cerca comune…"
- `municipality.loading` = "Caricamento comuni…"
- `municipality.error` = "Impossibile caricare i comuni"
- `municipality.empty` = "Nessun comune trovato"
- `municipality.more` = "… altri {n} risultati, raffina la ricerca"
- Errori validation form: "Seleziona un comune"

Eliminare le chiavi obsolete legate a `city`/`province` testuali nei 3 form.

## 6. Test & verification

### 6.1 Backend (`apps/api`)

- Test in `apps/api/src/modules/locations/services/locations.test.ts`:
  - `listAllMunicipalities` ritorna count == numero righe `municipality`.
  - Ordering ASC su `name`.
  - Ogni elemento ha esattamente `{ id, name, provinceAcronym }` (no extra fields).
  - Sigla provincia esiste sempre (no NULL).
- Test route: `GET /locations/municipalities/all` ritorna `Cache-Control` e `ETag` corretti.

### 6.2 Typecheck cross-workspace

`bun run typecheck` da root. Catalog propaga i nuovi tipi Eden Treaty: ogni rimozione di `city`/`province` o aggiunta di `municipalityId`/`municipality:{…}` produce errori in `apps/{admin,customer,seller}` finché i form non vengono adeguati. Questo è desiderabile — fa da checklist automatica.

### 6.3 Lint

`bun run lint` (Biome).

### 6.4 Manuale UI

`bun run dev:seller` (porta 3002). Verificare nei 3 form:
- Combobox precarica senza flash (loader prefetch funziona).
- Filter case-insensitive + deburr (`citta` matcha `Città di Castello`).
- Sigla matching (`(mi` → Milano, Milano Marittima, ecc.).
- Cap 50 + footer "altri N risultati" appare con query corta (es. `a`).
- Submit OK: network panel mostra `municipalityId` UUID nel body, DB persiste l'FK.
- Submit senza selezione: error validation visibile.
- Cambia comune e risubmit: la riga DB si aggiorna correttamente.

### 6.5 Seed end-to-end

`bun run infra:reset && bun run db:migrate && bun run db:seed`: l'intera fixture chain deve girare verde producendo seller/store/profile con `municipality_id` FK valide.

## 7. Rollout

Un singolo PR (feature branch), niente flag:

1. Migration + schema DB.
2. Endpoint API + service.
3. Schemi forms (TypeBox) + service layer.
4. Componente `MunicipalityCombobox` in `@bibs/ui`.
5. Hook `useMunicipalities` in `apps/seller`.
6. Refactor dei 3 form.
7. Seed riscritto.
8. i18n.
9. Typecheck / lint / test / smoke manuale.

## 8. Out of scope (esplicito)

- **Virtualization**: non necessaria con cap 50. Riservata se misuriamo problemi.
- **Snapshot storico** del comune in ordini/indirizzi (es. "domicilio al momento dell'ordine"): non richiesto oggi. Resta possibile in futuro aggiungendo un campo `*_snapshot jsonb`.
- **Customer address form**: non esiste ancora. Quando arriverà, userà gli stessi componenti.
- **Endpoint server-side search testuale** (`?q=…`): non aggiunto. Tutto in memoria client-side.
- **Admin tooling** sui comuni (vedi/edita comuni): l'endpoint paginato già esistente basta.
- **Fallback estero**: bibs è Italia-only nel dominio. Niente toggle.

## 9. Open questions

Nessuna al momento. Tutte le decisioni di brainstorming sono chiuse.
