# Analisi dei follow-up non implementati — 2026-09-24

> Tutti i follow-up, deferral e "fuori scope" dichiarati nelle **171 PR mergiate fino a #190**, più
> [`2026-06-07-followup-gap-analysis.md`](2026-06-07-followup-gap-analysis.md), gli audit del
> 2026-05-29 e del 2026-06-15 e le note di progetto, verificati uno a uno contro `main` a
> **`200ed0d`**. Questo documento **sostituisce** l'analisi del 2026-06-07 come backlog di riferimento.
>
> **Come usarlo in una sessione nuova**: prendi un ID (es. `P0.1`), rileggi l'evidenza indicata,
> **riverifica che sia ancora aperto** (i numeri di riga valgono a `200ed0d` e invecchiano), poi
> apri una PR per il cluster suggerito. Quando un item si chiude, spostalo in "Chiusi" con il numero di PR.

## Metodologia

| Fase | Dettaglio |
|---|---|
| **Estrazione** | `gh pr list --state merged` (171 PR) → sezioni e righe con follow-up/fuori scope/rimandato/debito/aperti; integrate con la gap analysis di giugno (P0–P6), gli audit e le memorie di progetto → **~150 voci** |
| **Verifica** | 4 agenti paralleli (API, seller+admin, customer, infra/deps), una verifica mirata per voce con evidenza `file:riga` o commit → **~22 chiuse/obsolete, ~128 aperte o parziali** |
| **Priorità** | P0 bug attivi di sicurezza/correttezza · P1 superfici di prodotto mancanti · P2 rete CI/test · P3 bug medi · P4 a11y/polish/i18n · P5 debito/refactor · P6 gate di go-live e backlog prodotto |

Contesto: bibs è in dev, non deployato (schema changes liberi); pesa di più ciò che tocca authz,
dati, denaro e le superfici che definiscono il prodotto.

Path relativi alla root del repo. `api/…` = `apps/api/src/…` salvo dove indicato.

---

## P0 — Bug attivi di sicurezza/correttezza

| ID | Item | Evidenza (@200ed0d) | Impatto | Effort |
|---|---|---|---|---|
| **P0.6** | Dialog prezzi admin: `parseFloat/parseInt` senza guardia → campo svuotato manda `NaN` a Stripe; Conferma disabilitato solo durante il pending. `changeData` delle richieste di modifica applicato con cast `as string` senza validazione per tipo; `reject-change` legge `(ctx as any).body?.reason` | `apps/admin/src/routes/_authenticated/billing/pricing.tsx:118,124,130,142`; `apps/api/src/modules/admin/services/sellers.ts:419-499`; `admin/routes/seller-changes.ts:83` | Prezzi Stripe corrotti; dati seller non validati | S |
| **P0.8** | Cambiare macro-categoria nel form prodotto **sovrascrive sempre** `vatRate`, anche se impostata a mano | `apps/seller/src/features/products/components/product-form.tsx:275-277` | Dato fiscale perso in silenzio | S |

**Taglio suggerito**: ~~PR A = P0.1 + P0.2 + P0.7~~ (fatta, #192) ·
~~PR B = P0.3 + P0.4 + P0.5~~ (fatta, #194) · PR C = P0.6 + P0.8 (form admin/seller).

---

## P1 — Superfici di prodotto mancanti

| ID | Item | Evidenza | Note | Effort |
|---|---|---|---|---|
| **P1.1** | **Checkout customer** (creazione ordine dal carrello) | `apps/customer/src/routes/_authenticated/cart.tsx:70` (commento: nessun CTA perché non esiste la pagina) | Include: svuotare le righe ordinate dal carrello (debito #163), P0.4 come prerequisito, apportionment sconto punti sul castelletto (P6.2) | L |
| **P1.2** | **Pagina ordini seller** + castelletto IVA (`order.vatBreakdown`) | nessuna route orders in `apps/seller/src/routes/_authenticated/` | Il seller non può vedere né evadere ordini; i dati API ci sono (#82) | M–L |
| **P1.3** | **Home seller con dati veri** | `apps/seller/src/routes/_authenticated/index.tsx:23` (`TODAY_LABEL = "Venerdì 22 maggio"`), `:25-30` stats "—", `:44-86` azioni finte ("3 ordini da preparare" `:49`) | Solo l'alert orari è reale. Dipende in parte da P1.2. Include i rimandi di #183: funzione pura estratta dall'IIFE (`:103-137`), ordinamento per urgenza (`:139-141`) | M |
| **P1.4** | **Geocoding dei negozi creati dal seller** | nessun uso di geocode/location in `apps/seller/src` | Un negozio creato dal seller non ha coordinate → invisibile nelle ricerche per prossimità. L'API di geocoding esiste (#175) | M |
| **P1.5** | **Snapshot indirizzo sugli ordini** | `apps/api/src/db/schemas/order.ts:55-57` (`onDelete: "set null"`) | Cancellando un indirizzo dalla rubrica gli ordini passati lo perdono. Cura come lo snapshot IVA (#82). Naturale insieme a P1.1 | S |
| **P1.6** | **Account hub customer**: storico ordini e movimenti punti | `customer/routes/points.ts:9`, `customer/routes/orders.ts:24` inutilizzati; FE usa solo `profile.data.points` (`profile-identity.tsx:118`) | Dopo P1.1 | M |
| **P1.7** | **Billing seller**: email di dunning/cancellazione; riattivazione self-service di negozi `canceled` | `packages/emails/emails/` (3 template); `seller/services/stores.ts:352` (reactivate solo `canceling`) | Un negozio `canceled` è morto senza intervento manuale | M |

---

## P2 — Rete di sicurezza CI/test

| ID | Item | Evidenza | Effort |
|---|---|---|---|
| **P2.1** | TanStack ancora a `latest` nel catalog (10 voci) + **nessun job `vite build`** per i 3 frontend | `package.json:46-54`; `.github/workflows/ci.yml` (solo lint/typecheck/api-test) | S |
| **P2.2** | Seller senza test né script `test`; admin con vitest/jsdom/testing-library installati ma **zero test** (infra morta) | `apps/admin/package.json:15,55,57`; nessun `*.test.*` in `apps/seller` | M (decidere: rimuovere infra admin o gate FE vero) |
| **P2.3** | Nessun job CI `docker build` di `apps/api/Dockerfile` | `ci.yml` | S |
| **P2.4** | ~~Test HTTP dei guard owner-only su employees/settings/billing~~ (fatto in #192, più stores e checkout); restano l'e2e del rollback di `acceptInvite` e il test d'integrazione del resend pending-email | `apps/api/tests/integration/registration-accept-invite.test.ts` | S |
| **P2.5** | Biome spento su tutto `packages/ui/**`, componenti bibs-authored inclusi | `biome.json:59-63` | S–M |

---

## P3 — Bug medi e affidabilità

### P3.1 — API sweep
- **Ricerca**: `radius` senza min/max; log `hasGeoFilter` falso con lat o lng = 0 — `api/lib/queries.ts:97-101,155-159`, `customer/routes/stores.ts:33`, `customer/routes/products.ts:29`.
- **ILIKE senza escape** di `%`/`_` (cercare "_" matcha tutto) — `seller/services/brands.ts:20`, `seller/services/discounts.ts:306`, `admin/services/billing.ts:147`, `admin/services/sellers.ts:49`, `list-by-name-paged.ts:34`, `customer/services/store-search-conditions.ts:42`.
- **Cap immagini TOCTOU** (count-then-insert senza lock) + doppio ownership check in `transitionOrder` — `seller/services/images.ts:24-29`, `store-images.ts:28`, `seller/services/orders.ts:44-49`.
- **Import CSV prodotti** tiene `categoryIds[0]` e scarta il resto in silenzio (serve un canale `warnings` sganciato da `failed`) — `seller/services/product-import.ts:218-220`.
- **Import matrice caratteristiche**: righe con chiave duplicata saltate con `continue`, fuori da ogni contatore — `admin/services/characteristic-import.ts:578`.
- **Telefono indirizzo non svuotabile** (opzionale, `minLength 5`, non nullable; attenzione: union TypeBox nel body collassa l'inference Eden) — `customer/routes/addresses.ts:121-127`, `customer/services/addresses.ts:145`.
- **Settings seller**: nessun check di collisione P.IVA alla richiesta (emerge all'approvazione); upload S3 prima dell'insert (file orfani); tutte le richieste caricate e filtrate in JS — `seller/services/settings.ts:54,94,266-304,326-345`.
- **Invito dipendente**: re-invito → 409, nessuna route di resend (un commento sostiene il contrario) — `seller/services/employees.ts:114-123,151`.
- **`/ready`**: `HeadBucket` S3 senza timeout (la probe può appendersi); `x-request-id` in ingresso ignorato — `api/lib/s3.ts:22-30,95-101`, `plugins/request-id.ts:6`.

### P3.2 — Seller/Admin FE sweep
- `?page=abc` → `Number(...)` senza guardia NaN/clamp — seller `products/index.tsx:104-105`, `promotions/index.tsx:41-42`, `team/index.tsx:67-68`; admin `users.tsx:51-52`.
- Race nella cella stock: `commitSet` non attende un `adjust` in volo — `apps/seller/src/features/products/components/stock-editor-cell.tsx:98-130`.
- Stock negativo/frazionario non clampato lato client (l'API rifiuta → toast grezzo) — `store-assignment-dialog.tsx:46-51,122-128`.
- Toast di errore ad hoc invece di `edenMessage`/`unwrap` (`packages/ui/src/lib/api-client.ts:47`) — `use-stock-adjust-mutation.ts:73,89`, `stock-editor-cell.tsx:57,124`, admin `holidays-panel.tsx:102,130`, `product-categories.config.tsx:43,151`, `product-characteristics.config.tsx:173`, `billing/subscriptions.tsx:44`.
- `use-product-mutations.ts:33-35` non invalida `seller-categories-in-use`; `void activeStoreId` residuo `:30,:113`; `hooks/use-onboarding.ts:7-18` gira anche per gli employee; `promotions/$discountId.tsx:120` `DiscountForm` senza `key` (default stantii tra sconti).
- `/store/closures` senza owner gate lato client → l'employee vede un 403 invece di un redirect (la dashboard lo linka, `index.tsx:135`) — `store/closures.tsx:13-20`.
- Admin abbonamenti: `page:1, limit:50` fissi, niente paginazione — `apps/admin/src/routes/_authenticated/billing/subscriptions.tsx:38-39`.

### P3.3 — Customer FE sweep
- Facet senza ramo d'errore: se falliscono, totali a 0 → il rail dice "Nessun negozio aperto" e disabilita il toggle — `use-product-facets.ts:69-75`, `use-store-facets.ts`.
- `adoptNear` rifiuta `near=gps` quando `geoStatus !== "granted"` (anche durante `probing`) → deep link perso — `apps/customer/src/features/location/search-origin.tsx:138`.
- "Nessun negozio aperto in questo momento" mostrato anche quando la lista è vuota per il testo; niente `aria-live` sul conteggio; facet senza `keepPreviousData` (skeleton a ogni cambio) — `store-filters.tsx:211-216`, `product-filters.tsx:274`, `routes/_authenticated/{products,stores}/index.tsx`.
- Scheda prodotto a 390px: "Aggiungi" cappato a 320px — `features/products/product-offer.tsx:64` (`max-w-xs`).

### P3.4 — UI condivisa
- `toggle-group.tsx`: `data-vertical:`/`group-data-horizontal/...` non combaciano mai con `data-orientation` → angoli/bordi uniti mancanti (cambia l'aspetto di Lista/Mappa su `/stores`: PR dedicata) — `packages/ui/src/components/toggle-group.tsx:40,43,74`.
- `DataPagination` senza clamp di pagina fuori range — `packages/ui/src/components/data-pagination.tsx:36-37,79`.
- verify-email: cooldown armato al mount anche senza invio reale (resend bloccato 60 s) — `apps/{customer,seller}/src/routes/verify-email.tsx:29`; tick di `use-cooldown.ts` non allineati al secondo.

---

## P4 — Accessibilità, polish, i18n

- **Focus ring saffron** (DESIGN.md) solo su search/filtri; Input/Textarea/Combobox condivisi usano `--ring: ink-soft` — `packages/ui/src/components/input.tsx:11`, `globals.css:78` vs `apps/customer/src/features/search/search-field.tsx:38`. Tocca login/register/profilo/indirizzi.
- **Tap target Leaflet** < 44px (zoom 30px, cluster 36px) — `store-search-map.tsx:31`, `store-map.tsx`; nessun override `.leaflet-control` in `styles.css`.
- **Label senza `htmlFor`**: Brand (`product-form.tsx:417`), picker categorie (`product-categories-picker.tsx:64,89`).
- **TabNav**: `role=tablist/tab` senza roving tabindex/frecce/`aria-controls`; indicatore non rimisurato al caricamento font — `packages/ui/src/components/tab-nav.tsx`.
- `autoFocus` su firstName in `personal-info-card.tsx:173` (ruba il focus al load del profilo admin).
- **Rubrica indirizzi**: la mappa si ricentra al rilascio del pin (`address-map-preview.tsx:17-22,45-52`); permesso negato senza stato dedicato (`address-search.tsx:103-118`).
- **Seller polish**: niente sticky save bar su `/store`; `blue-*` residui (`discount-percent-input.tsx:45,72`, variante blue di `tab-nav.tsx:26`); `/team` senza PageSizeSelector/range (`team/index.tsx:811-822`); `ProductCategoriesPicker` ancora plurale e senza "Nessuna categoria disponibile per questa macro" (`product-categories-picker.tsx:18,29`).
- **Copy**: sottotitolo `/stores` ripete il placeholder (`apps/customer/messages/it.json:58-59`); email di verifica saluta col local-part ("Ciao mario.rossi,") perché la registrazione non chiede il nome (`packages/emails/emails/verification-email.tsx:15`, `registration/services.ts:106,279`) — decisione di prodotto.
- **Font**: admin carica ancora Bricolage; customer/seller caricano Satoshi come stylesheet bloccante senza preload e fanno preconnect a Google invece che a Fontshare — `apps/{customer,admin}/src/routes/__root.tsx:37-47`.
- **i18n (Paraglide)**: auth customer hardcoded (`forgot-password.tsx:108`, `reset-password.tsx:133`, `verify-email.tsx:67-96`, `register.tsx`, `login.tsx`); paginazione seller (`team/index.tsx:819`, `products/index.tsx:701`, `promotions/index.tsx:315`); `Dropzone` default in inglese senza prop `labels` (`packages/ui/src/components/dropzone.tsx`); `MunicipalityCombobox` italiano hardcoded (`municipality-combobox.tsx:76,102,104,164`); errori di `category-import.ts` in inglese (`:46,88,92,191,225,229`) e header/500 di `characteristic-import.ts` (`:27,309`).

---

## P5 — Debito e refactor (opportunistici)

- **Debito con innesco**: rail filtri duplicato (`FilterSection`, `Count`, `CategoryRow`, `ToggleRow`, `RadiusPill`…) tra `features/catalog/product-filters.tsx` e `features/stores/store-filters.tsx` — **la prossima modifica a uno dei due estrae prima i componenti comuni**.
- `@bibs/app-kit`: `env.ts` e `router.tsx` identici nelle 3 app, `auth-client.ts`/`api.ts` quasi.
- API: modulo `catalog/` (i read pubblici importano da `admin/services`), 14 chiamate manuali a `toMunicipalityCompact`, `reshapeWithMunicipality` mai estratto.
- Rinomina `activeStoresCount` → semantica "billable" (`seller/services/billing.ts:60,74`, `admin/services/billing.ts:27`, admin `billing/index.tsx:47`).
- Test: helper `createTestEmployee()` (21 insert duplicati); test su sotto-categorie omonime sotto macro diverse nel report di divergenza; regression test su XFF/x-real-ip di `plugins/better-auth.ts:5-25`.
- Ternario icona open-status duplicato (`store-cover.tsx:27`, `store-tile.tsx:14`).
- `deleteStore` esportato ma usato solo dai test (`seller/services/stores.ts:243`); `catch` che inghiottono l'errore nel seed (`fixtures/customers.ts:63`, `sellers.ts:335`, `team.ts:169`).
- Seed: nessun cliente ha punti (`fixtures/customers.ts:73-76`) → la pill saffron è invisibile in dev.
- UI admin per l'import CSV della matrice (endpoint `characteristic-imports.ts:54` esiste); riordino caratteristiche/opzioni.
- Agent tooling previsto in `CLAUDE.md:65-69` (api-endpoint-reviewer, drizzle-migration-reviewer, skill new-api-endpoint).

---

## P6 — Gate di go-live e backlog di prodotto

### Gate di go-live (rinvii consapevoli: diventano bloccanti al primo deploy)
- **P6.1 Security**: stati di registrazione distinguibili (enumeration, `registration/services.ts:28-50`); rate limiter in memoria (`plugins/rate-limit.ts:121`); bucket S3 pubblico (`lib/s3.ts:33`); redact pino solo top-level (`lib/logger.ts:26`); non-admin sull'app admin vedono solo un bottone di logout (`admin/_authenticated.tsx:45-58`).
- **P6.2 Fiscale**: castelletto costruito prima dello sconto punti (`customer/services/orders.ts:294-302`) — da fare con P1.1 o col layer fatturazione; SDI/XML, scontrino telematico, Stripe Tax, codici natura.
- **P6.3 Stripe**: nessun cron di riconciliazione né endpoint di replay (`api/jobs/`); `current_period_end` letto da `items[0]` (`subscription-updated.ts:43`); `productId` non validato in `updatePricing` (`admin/services/billing.ts:89`).
- **P6.4 Geocoding hardening** (#175): due chiamate Photon in sequenza (worst case ~10 s), fallimento della seconda fa fallire tutto, promozione a un livello, scrittura cache dentro il try, niente cron di retention su `geocoding_lookups`, niente versionamento del jsonb, limiter per IP — `locations/services/geocode.ts:57-81,160-163`, `locations/routes/locations.ts:183-186`.
- **P6.5 Storage/audit**: GC degli oggetti S3 orfani (avatar, negozi cancellati); UI e purge di `product_audit_log`.
- **P6.6 Deploy**: nessuna pipeline né gestione secrets (solo `ci.yml`).

### Backlog di prodotto
- Filtri/facet customer sulle caratteristiche.
- Bottom tab bar mobile (customer).
- Mappa: "cerca in quest'area" (bbox), mappa in home, hover card↔pin.
- Catalogo del negozio: ordinamento e filtri; recensioni e preferiti.
- Brand: filtro brand nella UI seller, check digit EAN, catalogo brand curato da admin, bulk edit/delete.
- Employee: permessi granulari (`api/lib/permissions.ts:24-27` vuoto), push real-time su de-assign/ban, `activeStoreId` lato server (modulo `me/`).
- Deps major rimandate: typescript 7, vitest 5, jsdom 30, recharts 3 (primitive inutilizzata), react-day-picker 10, react-dropzone (15 → ultima major); `@types/node` resta a `^22` per policy.

---

## Da verificare dal vivo (codice non conclusivo)

- **#189**: nella lista prodotti seller, una ricerca senza risultati mostrerebbe lo stato vuoto del primo avvio. `isPristineCatalogView` (`apps/seller/src/routes/_authenticated/products/index.tsx:250-271`) sembra corretto: serve una riproduzione.
- **#52 P7/P8/P9**: colonna di `/profile` stretta (`max-w-4xl`), header di `/products` verboso, piede della sidebar che nasconde logout/profilo — da giudicare a occhio.

---

## Chiusi

| ID | Item | PR |
|---|---|---|
| **P0.1** | Parità owner/employee: `requireOwner` su `/stores/archived` e sulle 3 route di checkout; il ramo employee del guard controlla `onboardingStatus` (`resolveSellerAccess()` in `seller/context.ts`); «Archivio» nascosto ai dipendenti nel seller | #192 |
| **P0.2** | Prefill EAN: tra seller ma solo prodotti `active` in un negozio `publiclyVisibleStore()` (dati già pubblici); cestinati, disabilitati e negozi nascosti esclusi | #192 |
| **P0.7** | `verifySeller`/`rejectSeller`: CAS su `pending_review`, 404 se il seller non esiste, 409 altrimenti, nessun effetto su `vatStatus` | #192 |
| **P0.3** | `pickupOrder` solo per `pay_pickup`/`reserve_pickup` in `ready_for_pickup`; la scadenza della prenotazione ora persiste (il 400 annullava expire e rimborso) | #194 |
| **P0.4** | `createOrder` solo su negozi `publiclyVisibleStore()` e prodotti `active`, dentro la tx (stessa regola del carrello) | #194 |
| **P0.5** | Input interi `t.Integer` (stock, position anche multipart, quantity, pointsToSpend, `PaginationQuery` condivisa); `birthDate`/`documentExpiry` con `format: "calendar-date"` | #194 |

## Chiusi dopo la gap analysis di giugno (nessuna azione)

Doppio abbonamento sul resume del checkout (#95) · parser CSV multi-riga (#94) · bug orari di
apertura: isDirty fantasma, reset post-save, all-off → null, leak degli orari default, validazione
overlap (#93) · birthDate svuotata (#94) · QueryClient per richiesta in SSR (#94) · FK 23503 → 400
(#66, rende obsoleto il follow-up di #184) · valori di caratteristica cancellati al cambio di
sotto-categoria con conferma (#187) · token `warning` in DESIGN.md (#169) · minio da quay.io (#188) ·
TanStack Table 9 e `match-sorter-utils` rimossa (#160) · sharp 0.35 · codice morto rimosso
(`use-products.ts`, `SortableTableHead`, `ErrorResponse`, `BetterAuthHeader` — #137/#138) · warning
`useOptionalChain` (#111, #165) · email branded di reset password · test FE customer in CI tramite
lo script `test` di root · `DiscountedPrice` non più morto (3 importer) · `ProductPickerSheet`
obsoleto (componente rimosso) · doc drift su conteggi endpoint e `/health`.

## Sequenza consigliata

1. **P0** in 3 PR (A authz+stato con test di guard, B ordini+schema, C form) — prima di toccare il checkout.
2. **P2.1** (pin TanStack + job `vite build`): mezz'ora, protegge tutto il resto.
3. **P1.1 checkout** (+ P1.5 snapshot indirizzo, P6.2 apportionment punti), poi **P1.2 ordini seller** e **P1.3 home**.
4. **P1.4 geocoding negozi seller**: senza, la ricerca per prossimità non vede i negozi reali.
5. Una sweep P3 ogni tanto come lavoro a basso rischio; P4/P5 quando si tocca la zona.
6. **P6** diventa checklist bloccante al primo segnale di go-live.
