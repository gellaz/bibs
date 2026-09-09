# Assegnazioni employee↔negozio e ciclo di vita del negozio — design

**Date:** 2026-09-09
**Status:** implemented
**Riferimenti:** i riferimenti `file:riga` in questo documento puntano allo stato pre-implementazione (base `3998178`)
**Branch:** `fix/employee-store-lifecycle`

## Problema

Accettando un invito, `acceptInvite` assegna il nuovo employee anche ai negozi
soft-deleted (`stores.deleted_at`, il modo in cui l'app cancella davvero i
negozi). Misurato nella PR #150 e documentato in un commento in
`apps/api/tests/integration/registration-accept-invite.test.ts`.

`acceptInvite` non è però il problema: è una delle **quattro porte** che portano
allo stesso stato — una riga di `store_employee_stores` che punta a un negozio
non vivo:

1. `inviteEmployee` — la validazione degli `storeIds` controlla solo
   l'appartenenza al seller, non che il negozio sia vivo;
2. `acceptInvite` — propaga le righe dell'invito, soft-deleted incluse;
3. `setEmployeeStores` — stessa validazione incompleta di (1);
4. **il soft delete del negozio** — `deleteStore` scrive solo `deletedAt` e non
   tocca `store_employee_stores`: le assegnazioni degli employee già esistenti
   sopravvivono al negozio.

La causa comune è a valle: `store_employee_stores` viene letto come se fosse la
verità sull'accesso, senza mai verificare che il negozio sia ancora vivo.

**Effetto peggiore — asimmetria a rovescio.** Su un negozio soft-deleted
l'**owner** è fuori (`ensureStoreOwnership` filtra `isNull(deletedAt)` → 404),
l'**employee assegnato** è dentro (403 solo se non assegnato) e nessun servizio
a valle ricontrolla `deletedAt`. Oggi un employee può ancora scrivere
stock/prodotti e leggere ordini di un negozio che il suo owner non vede più.
Questo vale già per gli employee esistenti, senza bisogno di alcun invito.

## Stato attuale misurato (2026-09-09)

**Il lettore centrale non filtra `deleted_at`:**
`getEmployeeAssignedStoreIds` (`apps/api/src/modules/seller/services/access.ts:10`)
è l'unica fonte dello scoping employee. Da lì discende tutto:

| Consumatore | File | Effetto |
|---|---|---|
| `ensureStoreAccess` | `seller/context.ts:112` | gate di route products / stock / orders / store-images |
| `getAccessibleStoreIdsFor` → `getAccessibleStoreIds()` | `seller/context.ts:100`, `seller/index.ts:82,116` | ~14 call site in `routes/{orders,products}.ts` |
| `getSellerSettings` | `seller/services/settings.ts:100` | campo `assignedStoreIds` nel payload |

**Altri lettori non filtrati (lato owner):**

- `getEmployeeStores` (`seller/services/employees.ts:269`) — INNER JOIN su
  `store` senza `deletedAt`: il dialog assegnazioni riceve anche i cancellati;
- `listEmployees` (`employees.ts:31`) e `listEmployeeInvitations`
  (`employees.ts:169`) — `storeIds` grezzi. In UI `StoreChips`
  (`apps/seller/src/features/team/components/store-chips.tsx:34`) risolve il
  nome con `useStores()`, che filtra i cancellati, e stampa `"?"`.

**Il soft delete non è solo un'azione del seller:** lo eseguono anche il webhook
`subscription.deleted`
(`apps/api/src/modules/webhooks/services/handlers/subscription-deleted.ts:36`) e
il job `auto-cancel-suspended-stores` (`apps/api/src/jobs/auto-cancel-suspended-stores.ts:74`).
Un mancato pagamento cancella il negozio.

**Il ripristino non esiste ancora:** nessun punto del codice riporta `deletedAt`
a `null`. Ci sono solo `listArchivedStores` (read-only) e
`reactivateStoreSubscription`, che agisce su Stripe (`cancel_at_period_end`),
non sul negozio. Marco ha confermato in brainstorming che **il ripristino è
qualcosa che vuole poter avere** (il seller ri-sottoscrive e riprende il suo
negozio): il design lo deve rendere possibile senza doverlo costruire ora.

## La decisione (invariante)

> Un'assegnazione employee↔negozio è una **dichiarazione durevole di intento**,
> indipendente dallo stato di vita del negozio. L'accesso non *è*
> l'assegnazione: è `assegnazione AND negozio vivo`, derivato a ogni confine di
> lettura. **Il ciclo di vita del negozio non scrive mai su
> `store_employee_stores`.**

Le quattro domande aperte, chiuse:

1. **Un employee nasce assegnato a un negozio soft-deleted?** La riga sì,
   l'accesso no. È l'unica risposta che rende il nuovo employee
   indistinguibile da uno preesistente il cui negozio è morto ieri — e sono lo
   stesso stato, quindi devono avere la stessa regola.
2. **Cosa succede all'assegnazione se il negozio viene ripristinato?** Torna
   viva da sé, senza che il ripristino sappia nulla degli employee. È il
   beneficio che paga questa scelta.
3. **Qualcosa a valle legge `store_employee_stores` senza filtrare
   `deleted_at`?** Sì: quattro letture e due scritture, elencate sopra e
   corrette sotto.
4. **Vale anche per gli employee già esistenti?** È *la stessa cosa*:
   `acceptInvite` era solo la porta da cui il problema è stato visto.

### Alternativa scartata

**Purgare le righe al soft delete** (`deleteStore` + webhook + job cancellano
`store_employee_stores`; `acceptInvite` salta i soft-deleted). Dà un invariante
di dato ("ogni riga punta a un negozio vivo") e non richiede filtri in lettura.
Scartata per tre ragioni concrete di questo repo:

- il soft delete esiste proprio per non distruggere — nessun'altra entità viene
  purgata quando un negozio muore;
- va tenuta in sincrono in **tre** punti di cancellazione, di cui due
  automatici: è il tipo di invariante che si rompe al quarto;
- rende il ripristino lossy per sempre, contro l'intenzione dichiarata.

### Corollari (non ovvi, vanno detti)

- **In scrittura si rifiuta, in propagazione si conserva.** Invitare o assegnare
  verso un negozio morto è creare intento nuovo verso un morto → 404. Propagare
  un invito il cui negozio è morto nel frattempo conserva un intento che era
  legittimo quando è stato creato → riga inerte. Regola unica: *non si crea, non
  si distrugge*.
- **L'owner non gestisce le righe dormienti.** Non sono nel picker (che viene da
  `useStores()`, già filtrato) e un suo salvataggio non le tocca.
- **La parità è su `deletedAt`, non sull'abbonamento.** L'owner oggi è gated
  solo da `deletedAt` (un negozio `suspended` gli resta accessibile): l'employee
  segue la stessa linea.

## Il cambiamento, per sito

### 1. Cuore — una funzione, copre gate + liste + settings

`apps/api/src/modules/seller/services/access.ts:10` — `getEmployeeAssignedStoreIds`:
aggiungi al query builder `innerJoin(store, eq(storeEmployeeStores.storeId, store.id))`
e `isNull(store.deletedAt)` nella `and(...)`. Aggiorna il jsdoc: "Returns the
store IDs an active employee is assigned to **and that are still live**".

Discendono in automatico: `ensureStoreAccess` (employee su negozio cancellato →
**403**, perché lo store semplicemente non è più in `assigned`: nessun branch
nuovo, e non è un leak — un id inesistente dà già 403 oggi),
`getAccessibleStoreIds` (orders/products), `settings.assignedStoreIds` (che per
un employee senza negozi vivi diventa `[]`; il campo non è consumato dal FE
seller).

Un cambio di comportamento da mettere a verbale: `ensureProductAccess`
(`seller/context.ts:136`) passa dagli store assegnati, quindi un prodotto che
esiste in stock **solo** in negozi cancellati passa da 200 a **403** per
l'employee, mentre l'owner continua a vederlo (l'ownership del prodotto è a
livello di seller, non di negozio). È coerente con la regola: i prodotti sono
del seller, l'accesso al dato di un negozio morto no.

### 2. Vista owner — tre letture

- `employees.ts:269` `getEmployeeStores`: aggiungi `isNull(storeTable.deletedAt)`
  alla `where` (l'INNER JOIN su `store` c'è già) → il dialog assegnazioni mostra
  solo negozi vivi, allineato al picker.
- `employees.ts:31` `listEmployees` e `employees.ts:169`
  `listEmployeeInvitations`: la relational query (`with: { storeAssignments }`)
  non può filtrare sulla tabella `store`. Aggiungi
  `getSellerStoreIds(sellerProfileId)` (già esistente in `seller/context.ts:40`,
  restituisce gli id dei negozi vivi del seller) **dentro il `Promise.all`
  esistente** — nessun round-trip in più — e filtra `storeIds` contro quel Set.
  Poiché un'assegnazione può puntare solo a un negozio dello stesso seller
  (validato in scrittura), filtrare sugli id vivi del seller è equivalente a
  filtrare `deleted_at IS NULL`. Direzione di import `services/employees.ts` →
  `../context` verificata senza ciclo (`context.ts` importa
  `./services/access.ts`, non `employees.ts`).
  → `StoreChips` non stampa più `"?"`; chi resta senza negozi vivi mostra
  "Nessun negozio" (copy già esistente, `store-chips.tsx:18`).
- **Non** si filtra la risposta di `cancelInvitation` (`employees.ts:188`): è
  l'eco di un'azione terminale, il FE non la rende. Scelta deliberata.

### 3. Scritture — due validazioni e un delete da restringere

- `employees.ts:92` (`inviteEmployee`) e `employees.ts:331`
  (`setEmployeeStores`): aggiungi `isNull(storeTable.deletedAt)` alla `and(...)`
  della validazione. Il 404 esistente ("Uno o più negozi non appartengono al tuo
  profilo") copre anche questo caso; il messaggio resta invariato — è un
  percorso raggiungibile solo da una UI stale.
- `employees.ts:345` (`setEmployeeStores`, dentro la transazione): il
  `delete(storeEmployeeStores).where(eq(storeEmployeeId, X))` cancella **tutte**
  le righe, dormienti incluse, e le righe dormienti non possono essere
  reinserite (la validazione ora le rifiuta). Restringi il delete ai soli negozi
  vivi del seller:

  ```ts
  await tx.delete(storeEmployeeStores).where(
      and(
          eq(storeEmployeeStores.storeEmployeeId, params.employeeId),
          inArray(
              storeEmployeeStores.storeId,
              tx
                  .select({ id: storeTable.id })
                  .from(storeTable)
                  .where(
                      and(
                          eq(storeTable.sellerProfileId, params.sellerProfileId),
                          isNull(storeTable.deletedAt),
                      ),
                  ),
          ),
      ),
  );
  ```

  Sono le due righe che rendono affidabile il ripristino: un salvataggio
  dell'owner non distrugge più l'intento verso un negozio archiviato. Nel
  percorso normale non c'è conflitto di PK sull'insert successivo: tutte le
  righe vive sono state cancellate e gli `uniqueStoreIds` sono già validati
  come vivi. Ma la validazione gira fuori dalla transazione, quindi un negozio
  può essere soft-deleted nella finestra tra quel controllo e la transazione:
  il delete ristretto non tocca più la riga preesistente per quel negozio,
  mentre l'insert proverebbe comunque a reinserirla — da qui
  `onConflictDoNothing()`, che risolve la race lasciando la riga dormiente.

### 4. `acceptInvite` — rimuovere il falso guardiano

`apps/api/src/modules/registration/services.ts:305-315`: **rimuovi** l'INNER
JOIN su `store` e il commento che lo giustifica ("so deleted stores are
silently dropped"). Non protegge nulla — l'hard delete è già coperto dalla FK
`employee_invitation_stores.store_id ON DELETE CASCADE`, verificato nella PR
#150 — e afferma il falso sui soft-deleted. La select torna una `select` semplice
su `employeeInvitationStores`, con un commento che dice la regola vera: i
soft-deleted si propagano per scelta e sono inerti al confine di lettura.

## Test

È qui che la decisione si chiude.

- `apps/api/tests/integration/registration-accept-invite.test.ts` — il caso oggi
  **deliberatamente non asserito** diventa un'asserzione: negozio soft-deleted
  tra invito e accettazione → la riga in `store_employee_stores` **c'è**. Il
  commento sul guardiano FK va riscritto per riflettere la decisione invece di
  registrare una domanda aperta.
- `apps/api/tests/integration/seller-access.test.ts` — employee assegnato +
  negozio soft-deleted → **403** su una route store-scoped (es. stock) e
  **assenza** dalle liste ordini/prodotti. È il test che chiude l'asimmetria
  owner/employee.
- `apps/api/tests/integration/seller-employees.test.ts` — tre casi:
  `getEmployeeStores` esclude il soft-deleted; `inviteEmployee` /
  `setEmployeeStores` rifiutano con 404 un negozio soft-deleted; un PUT con soli
  negozi vivi **non** distrugge la riga dormiente (assert diretto su
  `store_employee_stores`).

## Fuori scope (deliberato)

- Nessuna migrazione, nessuna colonna, nessuna tabella nuova.
- Nessun endpoint di ripristino negozio: quando arriverà non dovrà toccare le
  assegnazioni — è esattamente il punto di questo design.
- Nessun gate su abbonamento `suspended`/`canceled`: parità con l'owner.
- Nessuna UI "negozio archiviato" nella tabella team: le righe dormienti sono
  invisibili all'owner per scelta.
- `cancelInvitation` non filtra (vedi §2).

## Verifica

Zero cambi di contratto: `assignedStoreIds` resta `string[] | null`
(`apps/api/src/lib/schemas/composed.ts:164`), `storeIds` resta `string[]`, la
forma di `getEmployeeStores` è invariata. Nessun lavoro FE, nessun Eden treaty
da rigenerare, nessuna route nuova (quindi nessun `routeTree.gen.ts`).

Gate:

- `bun run --filter @bibs/api typecheck`
- `bun run --filter @bibs/api test` (unit + integration; l'integration usa
  l'isolamento per-file di `apps/api/scripts/test-integration.sh`)
- `bun run lint`

Il rischio è la superficie di `getEmployeeAssignedStoreIds`: è nel percorso di
~14 route. La copertura integration esistente su seller access/orders/products è
il paracadute.

## File toccati (riepilogo)

| File | Cambio |
|---|---|
| `apps/api/src/modules/seller/services/access.ts` | join + `isNull(deletedAt)` in `getEmployeeAssignedStoreIds` |
| `apps/api/src/modules/seller/services/employees.ts` | 3 letture filtrate, 2 validazioni, 1 delete restretto |
| `apps/api/src/modules/registration/services.ts` | rimozione INNER JOIN + commento corretto |
| `apps/api/tests/integration/registration-accept-invite.test.ts` | asserzione della decisione |
| `apps/api/tests/integration/seller-access.test.ts` | 403 + assenza dalle liste |
| `apps/api/tests/integration/seller-employees.test.ts` | vista owner, rifiuti, riga dormiente |
