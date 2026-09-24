# P0 gruppo B: ordini e schema. Piano di implementazione

> **Per gli agenti:** SUB-SKILL RICHIESTA: superpowers:executing-plans (esecuzione nativa, come il gruppo A). Gli step usano checkbox (`- [ ]`).

**Obiettivo:** chiudere P0.3, P0.4 e P0.5 del backlog in una sola PR.

**Architettura:** tutto lato API.
- **P0.3:** il ritiro fatto dal cliente ha una regola propria, più stretta della macchina a stati generica, che resta quella del seller.
- **P0.4:** `createOrder` applica la stessa definizione di «vendibile» che usa già il carrello: negozio `publiclyVisibleStore()` e prodotto `active`.
- **P0.5:** i campi interi passano a `t.Integer`. Le date usano `format: "date"`, registrato anche fuori da Elysia perché il form seller compila gli stessi schemi con `TypeCompiler`.

**Stack:** Elysia + TypeBox 0.34 (una sola copia, condivisa con il frontend via `@bibs/api/schemas`), Drizzle, bun test + testcontainers.

**Spec:** `docs/audit/2026-09-24-followup-gap-analysis.md`, righe P0.3, P0.4 e P0.5. Riverificati sul main a f002ada (dopo #192): tutti aperti, con le evidenze invariate.

## Vincoli globali

- Branch `fix/p0-orders-schema` da `origin/main`; mai commit su main.
- TDD: RED prima del fix, e mai indebolire produzione o asserzioni per ottenerlo.
- Si possono cambiare i test esistenti che **codificano il bug**, ma solo spostando il fixture sullo stato corretto, mai togliendo asserzioni. Ogni cambio del genere va nel ledger come ruling.
- `ServiceError(status, message)` con due soli argomenti.
- Verifica finale: `bun run lint`, typecheck per workspace (api, admin, seller, customer) con `$?` controllato uno per uno, `bun run test` in `apps/api`.
- PR con auto-merge squash. P0.3, P0.4 e P0.5 passano in «Chiusi» con il numero di PR nella stessa PR.

## Decisioni

- **Regola del ritiro del cliente:** solo per ordini `pay_pickup` o `reserve_pickup` in stato `ready_for_pickup`. Tipo sbagliato o stato diverso → 400 con messaggio italiano, prima di ogni altro effetto.
  - Scadenza di una prenotazione `confirmed`: il ramo che la marca `expired` resta raggiungibile solo da `ready_for_pickup`. Le prenotazioni scadute in `confirmed` le chiude già lo sweep (`job-expire-pending`).
  - La macchina a stati generica non cambia: `confirmed → completed` resta una mossa del seller.
- **Negozio o prodotto non vendibile in `createOrder`:** 404, gli stessi messaggi del carrello («Negozio non disponibile» / «Prodotto non disponibile»). Non si conferma l'esistenza di cose che non si possono comprare. Il controllo avviene dentro la transazione, prima dello stock.
- **Interi (P0.5), solo input:** le response restano `t.Number`, perché la serializzazione di un intero non si rompe. I campi:
  - `seller/routes/images.ts:61` position (multipart)
  - `seller/routes/store-images.ts:56` position (multipart)
  - `seller/routes/stores.ts:156` phoneNumbers[].position
  - `lib/schemas/forms/stores.ts:18` position
  - `seller/routes/stock.ts:49` stock
  - `seller/routes/stock.ts:84` stock
  - `customer/routes/orders.ts:70` quantity
  - `customer/routes/orders.ts:81` pointsToSpend
  - `seller/routes/brands.ts` page/limit (query)
  - `locations/routes/locations.ts:160` limit (query)
- **Date (P0.5):** `birthDate` e `documentExpiry` tengono il `pattern`, per il messaggio immediato nel form, e aggiungono `format: "date"`. Il nuovo `lib/schemas/forms/formats.ts` registra `date` in `FormatRegistry` se manca, con controllo di calendario (mesi 1–12, giorni per mese, bisestili). `forms/index.ts` lo importa per effetto collaterale, così il bundle seller lo include.

## Focus di revisione

1. **Multipart:** `position` arriva come stringa, e `t.Integer` deve comunque convertire `"2"` in 2. Un upload valido non deve diventare 422. Test nel Task 3 con `FormData` vera.
2. **`pointsToSpend: 0`** e **`quantity: 1`** restano validi: i limiti minimi non cambiano. Test nel Task 3.
3. **29 febbraio:** `2024-02-29` è valida, `2023-02-29` no. Il frontend e l'API devono dare lo stesso verdetto. Test nel Task 4 via `TypeCompiler`, cioè il percorso del frontend.
4. **Ordine con più righe, una non vendibile:** tutto l'ordine fallisce e nessuno stock viene scalato. Il controllo è nella tx. Test nel Task 2.
5. **Ritiro di un `reserve_pickup` `ready_for_pickup` scaduto:** resta il comportamento attuale (expire + rimborso + 400). Test nel Task 1.

---

### Task 1: ritiro del cliente solo per ordini da ritirare e pronti (P0.3)

**File:**
- Modifica: `apps/api/src/modules/customer/services/orders.ts:448-470` (`pickupOrder`)
- Test: `apps/api/tests/integration/customer-orders.test.ts:500-555`

- [ ] **Step 1: il test esistente va sullo stato corretto.** In `completes a confirmed pay_pickup order…`, dopo `createOrder`, porta l'ordine a `ready_for_pickup` con un update diretto (`db.update(order).set({ status: "ready_for_pickup" })`) e rinomina il test in `completes a ready_for_pickup pay_pickup order and awards points`. Le asserzioni restano identiche. Oggi passa comunque: `ready_for_pickup → completed` è già legale.
- [ ] **Step 2: test RED.** Helper `orderAt(type, status)`: crea l'ordine con `createOrder` (per `pay_deliver` anche l'indirizzo, come negli altri test del file) e ne forza lo stato. I casi, tutti con `rejects.toMatchObject({ status: 400 })`:
  - `pay_pickup` in `confirmed`;
  - `reserve_pickup` in `confirmed`;
  - `pay_deliver` in `shipped`;
  - `pay_deliver` in `ready_for_pickup`.

  Per ogni caso, dopo il rifiuto: lo stato dell'ordine è invariato e il saldo punti del cliente è ancora 0.
- [ ] **Step 3:** esegui `bun test tests/integration/customer-orders.test.ts -t pickupOrder --timeout 180000`. Atteso: FAIL sui casi `pay_pickup` e `reserve_pickup` in confirmed e `pay_deliver` shipped (oggi completano). `pay_deliver`/`ready_for_pickup` passa già, perché la macchina lo vieta.
- [ ] **Step 4: fix.** In `pickupOrder`, subito dopo il 404:
  ```ts
  		// Il ritiro è l'unica mossa del cliente: vale solo per ordini da
  		// ritirare che il negozio ha segnato pronti. Il resto della macchina a
  		// stati (confirmed → completed, shipped → completed) resta del seller.
  		if (
  			!PICKUP_TYPES.includes(existing.type as OrderType) ||
  			existing.status !== "ready_for_pickup"
  		)
  			throw new ServiceError(400, "L'ordine non è pronto per il ritiro");
  ```
  con `const PICKUP_TYPES: readonly OrderType[] = ["pay_pickup", "reserve_pickup"];` a livello di modulo. `assertTransition` resta dopo, come seconda linea.
- [ ] **Step 5: test di non regressione (Focus 5).** Un `reserve_pickup` in `ready_for_pickup` con `reservationExpiresAt` nel passato → 400 «Reservation has expired», ordine `expired`, stock rimborsato. Aggiungilo se nel file non c'è già un caso equivalente (cerca `Reservation has expired`).
- [ ] **Step 6:** stesso comando dello Step 3 → PASS. Commit: `fix(orders): il cliente ritira solo ordini da ritirare già pronti`.

### Task 2: `createOrder` solo su merce vendibile (P0.4)

**File:**
- Modifica: `apps/api/src/modules/customer/services/orders.ts:~215-250`
- Test: `apps/api/tests/integration/customer-orders.test.ts`; fixture di tutti i file `customer-orders*.test.ts`

- [ ] **Step 1: fixture pubbliche (verdi prima e dopo).** In ogni file di test che chiama `createOrder` (`customer-orders`, `-vat`, `-discounts`, `-address-idor`), dopo ogni `createTestStore` usato per ordinare, aggiungi `await createTestStoreSubscription(db, store.id)`. Esegui i 4 file: devono restare verdi.
- [ ] **Step 2: test RED** in `customer-orders.test.ts`, `describe("createOrder — sellable only")`. Ogni caso con `rejects.toMatchObject({ status: 404 })`, controllando poi che lo stock sia invariato e che non esista nessun ordine:
  - negozio senza abbonamento;
  - abbonamento `suspended`;
  - abbonamento `canceled`;
  - negozio archiviato (`deletedAt`);
  - prodotto `disabled`;
  - prodotto `trashed`;
  - due righe, la seconda di un prodotto `disabled` (Focus 4): anche lo stock della prima resta invariato.

  Più un caso positivo: negozio `canceling`, l'ordine va a buon fine.
- [ ] **Step 3:** `bun test tests/integration/customer-orders.test.ts -t "sellable only" --timeout 180000`. Atteso: FAIL sui 7 casi negativi, PASS su `canceling`.
- [ ] **Step 4: fix.** In `createOrder`, all'inizio della transazione:
  ```ts
  		// Stessa definizione di «vendibile» del carrello: negozio visibile al
  		// pubblico, prodotto attivo. Controllato dentro la tx, prima dello stock,
  		// così una riga non vendibile annulla l'intero ordine.
  		const [sellableStore] = await tx
  			.select({ id: store.id })
  			.from(store)
  			.where(and(eq(store.id, storeId), publiclyVisibleStore()))
  			.limit(1);
  		if (!sellableStore) throw new ServiceError(404, "Negozio non disponibile");
  ```
  e nel loop, subito dopo `if (!sp) …`: `if (sp.product.status !== "active") throw new ServiceError(404, "Prodotto non disponibile");`. Importa `store` e `publiclyVisibleStore` se mancano.
- [ ] **Step 5:** i 4 file `customer-orders*`, `seller-orders.test.ts` e `customer-cart.test.ts` → PASS. Commit: `fix(orders): ordini solo su negozi visibili e prodotti attivi`.

### Task 3: interi veri negli input (P0.5a)

**File:**
- Modifica: i 10 campi elencati nelle Decisioni
- Crea: `apps/api/tests/modules/integer-inputs.test.ts`

Harness: route montate nude, come i test owner-only. La validazione gira prima del handler, quindi un frazionario deve dare **422** esatto. Oggi passa la validazione e il handler risponde 403 o 500.

- [ ] **Step 1: test RED.** Un caso per campo, con body o query validi tranne il frazionario:
  - PUT `/products/p/stores/s/stock` `{ stock: 1.5 }`;
  - POST o PUT del link negozi (verifica metodo e path in `stock.ts:40-49`) `{ storeIds: ["s"], stock: 2.5 }`;
  - POST `/stores` con `phoneNumbers: [{ number: "0512345678", position: 0.5 }]` (body valido come nel test owner-only degli stores);
  - PATCH `/stores/s` con lo stesso `phoneNumbers`;
  - POST `/products/p/images` multipart con `files` = PNG 8×8 e `position` = `"1.5"`;
  - POST `/stores/s/images` multipart, idem;
  - GET `/brands?limit=2.5`;
  - GET `/locations/…?limit=2.5` (route esatta da `locations.ts:150-170`);
  - POST `/orders` (customer) con `quantity: 1.5`, e poi `pointsToSpend: 0.5`.

  Più i positivi, che non devono dare 422 (Focus 1–2): multipart `position: "2"`, `quantity: 1`, `pointsToSpend: 0`.
- [ ] **Step 2:** `bun test tests/modules/integer-inputs.test.ts`. Atteso: FAIL sui frazionari; i positivi passano (≠ 422).
- [ ] **Step 3: fix.** `t.Number` → `t.Integer` (e `Type.Number` → `Type.Integer` in `forms/stores.ts`) sui 10 campi, con le stesse opzioni.
- [ ] **Step 4:** stesso comando → PASS, più il typecheck di api e seller (`forms/stores.ts` è condiviso). Commit: `fix(api): interi veri per stock, posizioni, quantità e punti`.

### Task 4: date di calendario reali (P0.5b)

**File:**
- Crea: `apps/api/src/lib/schemas/forms/formats.ts`
- Modifica: `apps/api/src/lib/schemas/forms/onboarding.ts:30,70`, `forms/index.ts`
- Crea: `apps/api/tests/lib/date-format.test.ts`

- [ ] **Step 1: test RED** con il percorso del frontend, cioè `TypeCompiler` senza importare Elysia:
  ```ts
  import { TypeCompiler } from "@sinclair/typebox/compiler";
  import { DocumentBody, PersonalInfoBody } from "@/lib/schemas/forms";
  ```
  - Per `PersonalInfoBody.birthDate` e `DocumentBody.documentExpiry`, rifiutati: `2024-13-45`, `2024-02-30`, `2023-02-29`, `2024-00-10`.
  - Accettati: `2024-02-29`, `1980-12-31`.
  - Il resto dell'oggetto è valido, come nel test owner-only delle impostazioni.
- [ ] **Step 2:** `bun test tests/lib/date-format.test.ts`. Atteso: FAIL sui 4 rifiutati.
- [ ] **Step 3: fix.**
  - `formats.ts`: `FormatRegistry.Set("date", isCalendarDate)` protetto da `if (!FormatRegistry.Has("date"))`. `isCalendarDate` fa il match `^(\d{4})-(\d{2})-(\d{2})$`, poi controlla mese 1–12 e giorno ≤ giorni del mese, con i bisestili (`y%4===0 && (y%100!==0 || y%400===0)`).
  - `forms/index.ts`: `import "./formats";` come prima riga.
  - In `onboarding.ts`, sui due campi: `format: "date"` accanto al `pattern`, e `error` diventa «Data non valida (AAAA-MM-GG)».
- [ ] **Step 4:** stesso comando → PASS, più `bun test tests/modules/` (registrazione e onboarding). Verifica anche l'API reale: in un test di route con Elysia già caricato, `PATCH /settings/personal` con `birthDate: "2024-02-30"` → 422. Aggiungilo in `tests/modules/seller-settings-owner-only.test.ts` come caso a sé. Lì il 422 arriva prima del 403 del guard, quindi il RED è onesto: oggi risponde 403. Commit: `fix(onboarding): date di nascita e scadenza documento solo se esistono`.

### Task 5: verifica, backlog, PR

- [ ] Lint, typecheck ×4 e `bun run test` in `apps/api`, con gli exit code letti uno per uno.
- [ ] Review finale su un agente nuovo con questo piano, lo spec e il ledger.
- [ ] Push, PR, auto-merge squash. Poi un commit docs nella stessa PR: P0.3, P0.4 e P0.5 dalla tabella P0 a «Chiusi» con #NN, e il «Taglio suggerito» aggiornato.
