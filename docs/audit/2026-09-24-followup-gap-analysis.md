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

Nessun P0 aperto: tutti chiusi in #192, #194 e #195 (vedi «Chiusi»).

**Taglio suggerito**: ~~PR A = P0.1 + P0.2 + P0.7~~ (fatta, #192) ·
~~PR B = P0.3 + P0.4 + P0.5~~ (fatta, #194) · ~~PR C = P0.6 + P0.8~~ (fatta, #195).

---

## P1 — Superfici di prodotto mancanti

Nessun P1 aperto: P1.3 (#207), P1.6 (#205) e P1.7 (#206) chiusi, vedi «Chiusi».

**P1.1, buco chiuso (#202)**: `pay_*` nasce sempre `pending` (`placeOrder`) e `POST /customer/orders`
accetta solo `reserve_pickup` (`direct` disabilitato in #208).

---

## P2 — Rete di sicurezza CI/test

Nessun P2 aperto: P2.1 (#196), P2.3 (#215), P2.5 (#216), P2.2 (#217) e P2.4 (#218) chiusi, vedi «Chiusi».

---

## P3 — Bug medi e affidabilità

### P3.1 — API sweep

- **Dati del cliente al seller**: gli ordini seller (`seller/services/orders.ts:143,182`, `user: true`) rispondono con `UserSchema` intero (`SellerOrderWithRelationsSchema` in `lib/schemas/composed.ts`), quindi il seller riceve `role`, `banned`, `banReason` e `banExpires` del cliente. Serve uno schema ridotto (`id`, `name`, `email`, `image`) e `columns` espliciti nella query.

Le altre voci sono chiuse in #209 (ricerca, ILIKE, cap immagini, telefono, `/ready`) e #210
(import, settings, inviti, errori definitivi, prefill EAN, richieste di modifica), vedi «Chiusi».
Il doppio controllo di ownership in `transitionOrder` non è un bug: è difesa in profondità
(proprietà del seller + negozi accessibili) su un'unica lettura, resta com'è.

### P3.2 — Seller/Admin FE sweep

Nessuna voce aperta: chiusa in #211, vedi «Chiusi». `use-onboarding` era già limitato ai seller
(`enabled` in `_authenticated.tsx`).

### P3.3 — Customer FE sweep

Nessuna voce aperta: chiusa in #212, vedi «Chiusi».

### P3.4 — UI condivisa

Nessuna voce aperta: `DataPagination` e verify-email/`use-cooldown` chiusi in #212, il toggle-group
in #213 (PR a parte perché cambia l'aspetto), vedi «Chiusi».

---

## P4 — Accessibilità, polish, i18n

- **i18n, residui** (#219/#220, #224): seller e admin da tradurre (~450 stringhe in ~75 file il seller, ~350 in ~45 l'admin; `it-IT` hardcoded, `Calendar` senza `locale`, `TableColumnsToggle`/`DataPagination`/`PageSizeSelector`/`CopyButton` di `packages/ui`): il selettore lì è solo in dev. Lingua solo nel cookie, per browser e per app: `user.locale` nel DB la farebbe seguire l'utente e permetterebbe email ed errori API nella sua lingua (oggi in italiano anche con UI inglese).

---

## P5 — Debito e refactor (opportunistici)

- `@bibs/app-kit`: `env.ts` e `router.tsx` identici nelle 3 app, `auth-client.ts`/`api.ts` quasi.
- API: 14 chiamate manuali a `toMunicipalityCompact`, `reshapeWithMunicipality` mai estratto (refactor medio: va fatto con un diff delle risposte).
- Test: test su sotto-categorie omonime sotto macro diverse nel report di divergenza; regression test su XFF/x-real-ip di `plugins/better-auth.ts:5-25`.
- UI admin per l'import CSV della matrice (endpoint `characteristic-imports.ts:54` esiste); riordino caratteristiche/opzioni.
- Agent tooling previsto in `CLAUDE.md:65-69` (api-endpoint-reviewer, drizzle-migration-reviewer, skill new-api-endpoint).

---

## P6 — Gate di go-live e backlog di prodotto

### Gate di go-live (rinvii consapevoli: diventano bloccanti al primo deploy)
- **P6.1 Security**: stati di registrazione distinguibili (enumeration, `registration/services.ts:28-50`); rate limiter in memoria (`plugins/rate-limit.ts:121`); bucket S3 pubblico (`lib/s3.ts:33`); redact pino solo top-level (`lib/logger.ts:26`); non-admin sull'app admin vedono solo un bottone di logout (`admin/_authenticated.tsx:45-58`).
- **P6.2 Fiscale**: layer di fatturazione — SDI/XML, scontrino telematico, Stripe Tax, codici natura. (La ripartizione dello sconto punti sul castelletto è chiusa, vedi «Chiusi».)
- **P6.3 Stripe**: nessun cron di riconciliazione né endpoint di replay (`api/jobs/`); `current_period_end` letto da `items[0]` (`subscription-updated.ts:43`); `productId` non validato in `updatePricing` (`admin/services/billing.ts:89`). Pagamenti PR2 (#202): nessuno sweep/alert per ordini pagati con `stripe_transfer_id` NULL dopo che Stripe smette di riconsegnare il webhook (~3 giorni; col settle dal cron un trasferimento fallito non si ritenta); storno del trasferimento fallito solo nel log (nessuna colonna); nessuna validazione del minimo Stripe (0,50 €) sull'importo PR2 (oggi un 502 «riprova» senza uscita); chiavi di idempotenza Stripe valide 24 h (trasferimento/rimborso riuscito + scrittura DB fallita + retry oltre 24 h → doppio movimento).
- **P6.4 Geocoding hardening** (#175): due chiamate Photon in sequenza (worst case ~10 s), fallimento della seconda fa fallire tutto, promozione a un livello, scrittura cache dentro il try, niente cron di retention su `geocoding_lookups`, niente versionamento del jsonb, limiter per IP — `locations/services/geocode.ts:57-81,160-163`, `locations/routes/locations.ts:183-186`.
- **P6.5 Storage/audit**: GC degli oggetti S3 orfani (avatar, negozi cancellati); UI e purge di `product_audit_log`.
- **P6.6 Deploy**: nessuna pipeline né gestione secrets (solo `ci.yml`).
- **P6.7 Immagine API** (#215): ~1,45 GB. Il runtime copia lo store bun del grafo `@bibs/api` + `@bibs/emails`, e `react-email` porta `next` con i binari swc (~380 MB), utili solo al server di preview; a runtime servono solo `sharp` (esterno al bundle) e `drizzle-kit`. Piste: migrazioni via migrator di `drizzle-orm` in uno script bundlato (via `drizzle-kit` dal runtime), store ridotto alle dipendenze di `sharp`. Il logger scrive anche su `./logs/app.log` dentro il container, oltre a stdout — `api/lib/logger.ts:9-12`, `apps/api/Dockerfile`.

### Backlog di prodotto
- P (`direct`): il customer inquadra il QR del negozio e paga dall'app; punti solo a pagamento
  riuscito. Serve una spec; fino ad allora `direct` è disabilitato come ingresso (#208).
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
| **P0.6** | Rettifica dell'evidenza: il `NaN` non arrivava a Stripe (l'API lo rifiutava con 422); i buchi erano `productId` libero (ora `^prod_…`) e il dialog (stato stringa, limiti dell'API, massimo due decimali, Conferma disabilitato con messaggio). `changeData` validato con lo schema di scrittura prima di applicarlo (400, resta `pending`); `reject-change` con body tipato | #195 |
| **P0.8** | La macro-categoria suggerisce l'aliquota solo finché non è una scelta del seller (in modifica quella salvata conta come scelta); altrimenti toast con l'aliquota mantenuta | #195 |
| **P2.1** | Le 9 voci TanStack del catalog (non 10: `react-table` era già pinnata) passano da `latest` a pin esatti sulle versioni del lockfile; nuovo job CI `web-build` (vite build per app + `git diff --exit-code` sui generati) | #196 |
| **P1.5** | Snapshot dell'indirizzo sull'ordine (`orders.shipping_address_snapshot`), scritto da `placeOrder`; la FK resta `set null` | #197 |
| **P6.2 (punti)** | Castelletto costruito sul lordo già scontato dai punti, ripartito tra le aliquote a resti maggiori (`apportionDiscount`): Σ castelletto = totale. Corretta anche la conversione punti→centesimi in virgola mobile (232 punti valevano 2,31 €) | #197 |
| **P1.2** | Pagina ordini seller: lista del negozio attivo con tab per stato (conteggi da `GET /seller/orders/counts`) e filtro tipologia, dettaglio con righe, riepilogo e castelletto IVA, azioni pronto/ritirato/annulla. Annullamento seller con rimborso di stock e punti (`PATCH /seller/orders/:id/cancel`). Corretto anche il crash delle letture ordini (seller e customer) sui negozi con coordinate: la geometria PostGIS non si legge nelle relazioni annidate | #198 |
| **Debito #163** | Le righe ordinate escono dal carrello nella stessa transazione del checkout (`createCheckout`); quelle non disponibili restano | #199 |
| **P1.1** | **Checkout customer** (creazione ordine dal carrello). Spec [`2026-09-24-customer-checkout-design.md`](../superpowers/specs/2026-09-24-customer-checkout-design.md), taglio in PR A–F (PP1 + PR2, PS3 rimandato): PP1 (#199), QR (#200), Connect (#201), PR2 (#202) | #199, #200, #201, #202 |
| **P1.4** | Posizione del negozio obbligatoria: `CreateStoreBody` (checkout e `POST /stores`) richiede `location` con limiti lat/lng, il webhook `checkout-completed` la scrive (i pending senza restano tollerati). Nel form seller: ricerca indirizzo su `/locations/geocode` che compila via/CAP/comune + mappa con pin trascinabile; per i negozi senza pin avviso in `/store` con «Posiziona dall'indirizzo» e voce "high" in home | #204 |
| **P1.6** | **Account hub customer**. Storico ordini già coperto da #199: le tab Prenotazioni/Pagati coprono tutti i tipi offerti (`direct` non è offerto al checkout). Movimenti punti: nuova pagina `/points` su `GET /customer/points` (saldo, movimenti paginati con tipo, importo con segno, data, link all'ordine); la pill punti del profilo porta lì anche a saldo zero; il dettaglio ordine mostra «Punti usati»/«Punti guadagnati» se ≠ 0. Il segno si deriva dal tipo (dal #208 `redeemed` è anche salvato negativo) | #205 |
| **P1.3** | Home seller con dati veri: `GET /seller/dashboard?storeId=` aggregato (ordini e fatturato lordo di oggi, giorno Europe/Rome calcolato in SQL; prodotti attivi; promo in corso; ordini confermati da preparare, esauriti, scorta bassa sotto `stores.low_stock_threshold` (default 5, modificabile in `/store`), promo che finiscono entro 3 giorni). In home data vera, stats reali, voci solo con count > 0; card recensioni rimossa; logica orari estratta dall'IIFE in una funzione pura testata e voci ordinate per urgenza (rimandi di #183) | #207 |
| **P1.7** | Billing seller: email «Pagamento non riuscito» (transizione → `past_due`), «Negozio sospeso» (primo `suspended`), «Negozio cancellato» (alla consegna che archivia il negozio, copy diversa per scelta del seller vs mancato pagamento), solo al titolare e dopo la tx, errori email che non rompono il webhook. Riattivazione self-service dei `canceled`: `POST /seller/stores/:storeId/reactivation-checkout` + ramo `reactivateStoreId` in `checkout-completed` (stessa riga di `store_subscriptions`, `deletedAt = null`, catalogo intatto), «Riattiva» in `/store/archived`. Niente email di «cancellazione programmata»: scelta di prodotto | #206 |
| **Punti gratis (`direct`)** | `POST /customer/orders` accettava `type: direct`, creato già `completed` con i punti accreditati senza alcun pagamento. Il body accetta solo `reserve_pickup` e `placeOrder` rifiuta `direct` con 400 (nessun altro ingresso lo usava); il flusso QR + pagamento resta nel backlog di prodotto | #208 |
| **Segno `redeemed`** | `redeemed` si salva con `amount` negativo, come diceva lo schema: Σ movimenti = saldo. CHECK di segno per tipo (`redeemed < 0`, `earned`/`refunded > 0`), righe storiche ribaltate da `0015_redeemed_negative_amount` (idempotente) | #208 |
| **P3.1 (input e probe)** | `radius` limitato a (0, 100] km; `hasGeoFilter` nei log vero anche con lat o lng = 0; `%`, `_` e `\\` neutralizzati in tutte le ricerche `ILIKE` (`lib/like.ts`); cap immagini di prodotto e negozio ricontrollato nella transazione d'inserimento con lock sulla riga padre (i file già caricati su S3 vengono cancellati); telefono dell'indirizzo cancellabile con stringa vuota (salvato `null`, il form lo manda sempre); `HeadBucket` di `/ready` con timeout di 3 s; `x-request-id` in ingresso riusato se ha forma di id | #209 |
| **P3.1 (import, settings, inviti)** | Import CSV prodotti: canale `warnings` (categorie oltre la prima, EAN già usato) sganciato da `failed`, così created + skipped + failed = righe del file; corretti anche i numeri di riga, sfalsati dopo una riga non valida. Matrice caratteristiche: le righe ripetute contano tra le saltate, quelle con `required` contraddittorio tra gli errori. Settings seller: P.IVA di un altro venditore rifiutata alla richiesta (409), pending cercato con una query mirata, immagine del documento cancellata da S3 se l'insert fallisce. Invito: `POST /seller/employees/invitations/:id/resend` (stesso link, scadenza a 7 giorni anche se già scaduto, 502 se l'email non parte) e «Reinvia» in `/team`. Errori definitivi: `unwrap` lancia un `ApiError` con lo status e il QueryClient dei 3 FE non riprova i 4xx; `GET /seller/billing/invoices` senza Customer Stripe risponde lista vuota; transizioni d'ordine non valide con messaggio in italiano. Prefill EAN applica l'aliquota suggerita dalla macro (stessa regola della scelta a mano). Richieste di modifica: chiave e URL dell'immagine del documento «entrambi o nessuno»; `pricing_config.stripe_product_id` salvato e precompilato nel dialog prezzi | #210 |
| **P3.2** | `?page`/`?limit` validati da `parsePaginationSearch` (`@bibs/ui/lib`: interi ≥ 1, limit ≤ 100) su prodotti, promozioni, team e utenti admin. Cella stock: il delta inviato resta nel valore ottimistico finché la risposta non arriva, e un valore assoluto digitato attende l'adjust in volo invece di corrergli contro. Scorta iniziale del dialog negozi solo cifre. Errori via `unwrap` condiviso (`ApiError` con status) in cella stock, festività, import CSV, macro-categorie e crud panel admin. Invalidazione di `seller-categories-in-use` su cambio stato/crea/modifica/assegnazione; rimosso `activeStoreId` morto; `DiscountForm` con `key`. `/store/closures`: redirect dei dipendenti, errore mostrato invece dello spinner infinito, e la home li manda a `/store`. Abbonamenti admin paginati | #211 |
| **P3.3** | Facet con ramo d'errore: `FacetsError` col riprova al posto di disponibilità e categorie invece dei totali a 0; `keepPreviousData` sui facet (niente skeleton a ogni cambio). «Nessun negozio aperto»/«Nessun prodotto in offerta» solo se qualcosa resta (`total > 0`). `aria-live="polite"` sul conteggio risultati di `/stores` e `/products`. `near=gps` aspetta la sonda dei permessi (`nearVerdict`: `wait` durante `probing`, adotta con `granted`/`pending` come il boot). «Aggiungi» a tutta colonna sotto `sm` | #212 |
| **P3.4 (paginazione, verify-email)** | `DataPagination` riporta dentro una pagina fuori intervallo (`clampPage`) e lo segnala con `replace: true`, così Indietro non rimbalza; team mostra la paginazione anche con `page` oltre l'ultima. verify-email arma il cooldown solo con `sentAt` (passato dalla registrazione, mai dal login); gli errori di `sendVerificationEmail` (che better-auth non lancia) arrivano in un toast italiano anche nei banner. `use-cooldown` si sveglia sul cambio di secondo invece che con un intervallo fisso | #212 |
| **P3.4 (toggle-group)** | `toggle-group.tsx`: i varianti `data-vertical:`/`group-data-horizontal/…` diventano `data-[orientation=…]`, che combacia con il `data-orientation` del Root. Nei gruppi senza spacing gli angoli esterni si arrotondano e tra le voci resta un solo bordo (prima: tutto squadrato e bordo doppio da 2px). Cambia l'aspetto di Lista/Mappa su `/stores`, del `ThemeToggle` e del toggle delle caratteristiche prodotto nel seller | #213 |
| **P5 (rail filtri)** | Rail filtri di `/stores` e `/products` estratti in `customer/features/search/filter-rail/`: primitive (`FilterSection`, `CategoryRow`, `ToggleRow` con icona da prop, `RadiusPill`…), `CategoryTree` con conteggio via accessor, `DistanceSection` con un solo `RADIUS_PRESETS`, logica di selezione pura e testata, `FacetsError` spostato lì. Restano per pagina disponibilità, prezzo, tipi dei filtri e chiavi Paraglide. Refactor puro: DOM dei rail identico prima/dopo su 25 stati | #214 |
| **P2.3** | Job CI `docker-build`: build di `apps/api/Dockerfile` (buildx, cache gha), `db:migrate` e avvio dell'immagine contro Postgres e MinIO della compose, `/ready` 200. Il Dockerfile non buildava (`packages/emails` assente) e l'immagine non partiva: `node_modules` di symlink rotti nel runtime, `sharp` incluso nel bundle, `./logs` non scrivibile | #215 |
| **P2.5** | Era spento solo il linter (formatter e organizeImports già attivi). I 20 componenti scritti per bibs passano da `packages/ui/src/components/` a `src/custom/` (`@bibs/ui/custom/*`); `src/components/` resta ai generati dai registry. Linter spento solo su `src/components/**`, `hooks/use-mobile.ts` e `lib/utils.ts`; nei nostri file l'unica diagnostica (`TabNav`, dipendenze dell'effetto di rimisura) è un'eccezione motivata | #216 |
| **P2.2** | Seller già coperto dal #198. I tre frontend passano a Vitest (`vitest.base.ts`: alias e React Compiler, `node` di default, jsdom per file); api ed emails restano su `bun test`. Admin nel `test` di root con i primi test: impatto e schemi delle caratteristiche, schema festività, `OnboardingStatusBadge` con jsdom e Testing Library | #217 |
| **P2.4** | Guard owner-only già coperti dal #192. Rollback di `acceptInvite` su DB vero (trigger di test sull'ultimo insert): utente cancellato, invito ancora `pending` e riutilizzabile. Resend pending-email con better-auth vero: entro 7 giorni nuovo link e 409 senza secondo utente, oltre i 7 giorni utente sostituito, verificato = 409 senza invii | #218 |
| **P4 (i18n)** | API: ~90 messaggi distinti di `ServiceError`, `error-handler`, import CSV e `okMessage` in italiano, stessa formula per lo stesso concetto (restano in inglese solo 6 messaggi per operatori: firma/segreto Stripe, pricing config, invarianti di abbonamento). FE: pagine auth customer su Paraglide, errori di better-auth tradotti dal `code` (`lib/auth-error.ts`) invece di mostrare il `message` inglese; range di paginazione seller con sostantivo e singolare su prodotti, promozioni, ordini e team; prop `labels` su `MunicipalityCombobox`; testi delle Dropzone seller su Paraglide passando i children (il componente generato non si tocca) | #219, #220 |
| **P4 (a11y e polish)** | Focus: The One Ring in DESIGN.md (Ink in chiaro, nuovo Ink Night in scuro, nelle tre app; campi con bordo + alone shadcn, il resto outline a 2px di distanza con l'utility `focus-ring`), al posto dei ring saffron a mano e dell'alone ink-soft. Tap target Leaflet a 44px (zoom, cluster, area del pin). Label collegate a Brand e picker categorie (ora `ProductCategoryPicker`, con «Nessuna categoria disponibile»). TabNav con roving tabindex, frecce/Home/End, `aria-label`/`aria-controls` e rimisura su resize del contenitore e caricamento font. Via `autoFocus` dal profilo. Rubrica: la mappa non si ricentra al rilascio del pin, permesso negato con messaggio invece del bottone inerte. Seller: save bar sticky su `/store` con modifiche in sospeso (layout `overflow-x-clip`, che sbloccava gli sticky) e via l'«Annulla» che non faceva niente, `blue-*` → Cobalt, `/team` con range e righe per pagina, login e reset-password con gli errori di better-auth tradotti dal `code` | #221 |
| **P4 (font)** | Le tre app caricano gli stessi font da `packages/ui`: Geist e Geist Mono self-hosted da `@fontsource-variable` (prima non li caricava nessuno: il testo cadeva sul sans di sistema), Satoshi con un `@font-face` nostro sul woff2 variabile della CDN Fontshare (la licenza ITF FFL vieta di distribuirlo da un repo pubblico) al posto dello stylesheet bloccante. Preload di Geist latin e Satoshi e preconnect a `cdn.fontshare.com` da `fontLinks`; via Bricolage dall'admin e i preconnect a Google | #222 |
| **P5 (sweep)** | Modulo `catalog/` per i quattro GET pubblici della tassonomia (non importano più da `admin/services`), `listByNamePaged` in `lib/`. `billableStoresCount` nel riepilogo billing seller (conta active, past_due e canceling); l'admin resta `activeStoresCount`, che conta davvero solo `active` accanto a `pastDueCount`/`cancelingCount`. Via `deleteStore` (solo test). `catch` del seed che stampano l'errore. customer1–5 con saldo punti e movimento «Bonus di benvenuto» (prima avevano punti solo tre clienti senza login documentato, dagli ordini seedati). Helper `createTestEmployee()` al posto di 24 insert in 8 file. `openStatusIcon` condiviso da tile e copertina | #223 |
| **P4 (locale en)** | Lingua nel cookie (strategia Paraglide `cookie` + `baseLocale`, niente prefisso URL: le tre app sono dietro login) e `paraglideMiddleware` in `src/server.ts`, quindi `<html lang>` e testi giusti in SSR. `LocaleToggle` condiviso (IT/EN, nomi nativi) nel menu utente e, nel customer, sulle pagine auth; in seller e admin solo in dev. Prezzi e date di `@bibs/ui` seguono la lingua tramite un resolver registrato da ogni app (`formatDateIt` → `formatDate`). Customer interamente in inglese: ultime stringhe, `ThemeToggle`/`PasswordInput` con `labels`, `it-IT` → `intlLocale()` | #224 |
| **P4 (i18n 422)** | I 422 di validazione non dicevano «Expected string»: il body era il JSON di Elysia (`type/on/property/expected/found/errors`; in produzione `{type, on, found}`), e i FE lo mostravano nel toast. Traduzione centralizzata in `lib/validation-message.ts` dal `ValueErrorType` del primo errore: «Etichetta: regola» con etichette italiane per i campi di input (`FIELD_LABELS`, path tecnico per gli altri, «(riga N)» negli array), rami degli Union di `t.Integer`/`t.Nullable`/`t.Date` rivalidati per dare la regola vera, `error:` già scritte sugli schemi rispettate, errori senza path (Decode in query) con la sola regola. Il log porta `on`/`field`/`valueErrorType` invece del messaggio, che conteneva il body inviato con le password; una response fuori schema è un 500; un file col contenuto diverso dal tipo (`INVALID_FILE_TYPE`, prima 500) è un 422. Nessuna modifica nei FE | #225 |
| **P4 (copy)** | Sottotitolo di `/stores` che ripeteva il placeholder → «Guarda chi è aperto, cosa vende e quanto è lontano.» (EN «See who's open, what they sell and how far away they are.»). Email di verifica e reset: saluto con `firstName` del profilo se c'è, altrimenti «Ciao,» (`greeting()` in `@bibs/emails`), mai più il local-part; scelta di prodotto: nessun nome chiesto in registrazione. La home customer non ricava più il nome da `user.name` (cade su «Bentornato su bibs») | #226 |
| **P4 (nome visibile)** | `displayName()` in `@bibs/ui/lib`: `user.name` se è un nome vero, altrimenti l'email intera (alla registrazione `name` è il local-part, e ogni form che salva nome e cognome riscrive `name`). Usato in colonna cliente di ordini, dettaglio e ritiro seller, team seller (titolare e dipendenti), menu utente nelle tre app, profilo customer, liste e dettaglio seller e utenti admin. Dove sotto il nome c'era l'email, la seconda riga sparisce se coincide. Inviti pending del team: solo l'email, senza il finto nome | #227 |

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
2. ~~**P2** (rete CI/test)~~ — P2.1 in #196, P2.3 in #215, P2.5 in #216, P2.2 in #217, P2.4 in #218.
3. ~~**P1.1 checkout** (+ P1.5 snapshot indirizzo, P6.2 apportionment punti), poi **P1.2 ordini seller**~~ — fatto in #199/#200/#201/#202.
4. ~~**P1.4 geocoding negozi seller**~~ — fatto in #204. ~~**P1.3 home seller**~~ — fatto in #207.
   ~~**P1.6 account hub customer**~~ — fatto in #205. ~~**P1.7 billing seller**~~ — fatto in #206.
5. Una sweep P3 ogni tanto come lavoro a basso rischio (P3.1 in #209/#210, P3.2 in #211, P3.3 in #212, P3.4 in #212/#213); P4/P5 quando si tocca la zona.
6. **P6** diventa checklist bloccante al primo segnale di go-live.
