# «Paga e ritira» in evidenza — design

**Date:** 2026-10-19
**Status:** da approvare (varianti scelte da Marco sulla preview `/pagamenti-preview`, route temporanea del seller)

## Problema

«Paga e ritira» si accende solo dopo che il titolare ha attivato i pagamenti online (Stripe Connect).
Oggi le due cose vivono in posti scollegati:

- lo switch sta in **Impostazioni negozio → Vendita** (`OrderTypesSection`), bloccato, con sotto una
  riga grigia «Attiva prima i pagamenti online dal profilo»;
- l'attivazione vera è la card «Pagamenti online» in **Profilo** (`OnlinePaymentsCard`).

Niente spinge il seller ad andarci. Secondo Marco il seller che non attiva **non sa che la funzione
esiste**: il problema è farla scoprire, non ridurre l'attrito a chi rimanda.

## Obiettivi

- Il titolare che non ha completato Stripe lo vede su ogni pagina finché non l'ha fatto, con un
  pulsante che apre subito Stripe.
- Chiunque lavori nel negozio (titolare e dipendenti) vede sempre in sidebar come comprano i clienti
  nel negozio attivo. Dopo l'attivazione è la sidebar a dire che in un negozio «Paga e ritira» è
  ancora spento: l'accensione resta a mano, negozio per negozio, e solo il titolare la fa.
- I pagamenti online hanno una sola casa: la scheda Vendita. Via la card dal Profilo.
- Il colore del token semantico `warning` diventa il giallo Segnale scelto da Marco.

## Non-obiettivi

- Accendere «Paga e ritira» in automatico sui negozi quando Stripe abilita l'account.
- Una card dedicata in dashboard (Marco: tolta, basta il banner).
- Un passo nuovo nel flusso del primo negozio.
- Email o notifiche di promemoria.
- Un «non mi interessa» definitivo o sincronizzato tra dispositivi.

## Anti-obiettivi

- Un avviso che non si può mai togliere e perseguita chi ha scelto di usare solo «Prenota e ritira».
- Due avvisi uguali sulla stessa pagina.
- Il giallo usato per stati neutri: il giallo vuol dire «c'è da fare qualcosa».
- Un dipendente che può cambiare le tipologie d'acquisto.

## Decisioni di Marco

1. **Banner in cima a ogni pagina, dashboard compresa** (variante A3 della preview), giallo
   Segnale. Lo vede solo il titolare (il dipendente non può attivare Stripe). Il banner **sparisce
   quando la procedura Stripe è fatta** (account abilitato); non ha uno stato «ora accendilo nel
   negozio».
2. **Niente card in dashboard.**
3. **Riquadro in Vendita** (variante C2) sotto lo switch «Paga e ritira», nei quattro stati: prende
   il posto della card del Profilo, che **sparisce dal Profilo**. Forma: una riga
   `flex flex-wrap items-center gap-3 rounded-md border p-3` dentro la sezione «Tipologie
   d'acquisto», con a sinistra lo `StatusBadge` dello stato (stessi toni e icone di `STATUS_BADGE`
   in `online-payments-card.tsx`), al centro il testo `text-sm muted` (più una riga `text-xs` per
   l'avviso versamenti), a destra i pulsanti (`size="sm"`: «Aggiorna stato» outline, poi il
   primario). Negli stati gialli fondo `warning`, negli altri solo `border`.
4. **Sidebar** (variante S2): un riquadro in fondo alla sidebar, sopra l'utente, «Come comprano i
   clienti», con una riga per tipologia: pallino pieno verde + «attivo», oppure pallino vuoto +
   «spento». **Lo vedono tutti** (titolare e dipendenti); **solo il titolare** può cliccarlo per
   andare a `/store?sezione=vendita` e cambiare le tipologie.
5. **Chiusura del banner**: la X lo nasconde **per 7 giorni su quel computer** (`localStorage` con
   la data di chiusura, letture e scritture in try/catch; se lo storage non c'è il banner si vede).
6. **`warning` resta il token semantico, con il giallo Segnale come colore.** Vedi «Colore».

## Stati

Lo stato viene da `GET /seller/settings` → `onlinePayments.status` (`none` · `incomplete` ·
`in_review` · `enabled`), già esposto al solo titolare e già usato dalla card del Profilo.

| Stato | Banner (tutte le pagine, solo titolare) | Riquadro C2 (Vendita) |
|---|---|---|
| `none` | giallo · ««Paga e ritira» è spento. Attiva i pagamenti online: i clienti pagano dall'app e passano solo a ritirare.» · **Attiva** | giallo · badge «Da attivare» · «Servono i pagamenti online per accendere «Paga e ritira». Pochi minuti su Stripe: dati dell'attività, documento e IBAN.» · **Attiva pagamenti online** |
| `incomplete` | giallo · «Attivazione a metà. Mancano alcuni dati su Stripe per accendere «Paga e ritira».» · **Completa** | giallo · badge «Da completare» · **Aggiorna stato** + **Completa l'attivazione** |
| `in_review` | neutro (bordo, fondo card) · «Stripe sta verificando i tuoi dati. Quando ha finito potrai accendere «Paga e ritira» nelle impostazioni del negozio.» · nessun pulsante | neutro · badge «In verifica» · **Aggiorna stato** |
| `enabled` | non c'è | neutro · badge «Pagamenti online attivi» · «Vale per tutti i tuoi negozi.» · se `!payoutsEnabled` anche «I versamenti sul tuo conto partono appena Stripe completa la verifica.» |

I testi sono le bozze della preview; quelli già esistenti in `messages/*.json` (`payments_*`) si
riusano dove dicono la stessa cosa. Se Stripe in seguito disabilita l'account, lo stato torna
indietro e il banner ricompare da solo. Il caso «Paga e ritira configurato ma account non più
abilitato» (oggi `store_order_types_pay_account_disabled`) resta coperto: lo switch è acceso, il
riquadro è giallo e il testo dice che i clienti non vedono questa tipologia.

**Sidebar S2** — mostra `offeredOrderTypes` del negozio attivo (ciò che il cliente vede davvero al
checkout), non `orderTypes`: se «Paga e ritira» è configurato ma l'account non incassa, risulta
«spento». Colori neutri (`success` per «attivo», `muted` per «spento»): niente giallo in sidebar.
Visibile in ogni stato Stripe.

## Comportamento

- **Pulsanti Attiva / Completa** (banner, riquadro): chiamano `useStartOnboarding()` e vanno dritti
  su Stripe, come il pulsante del Profilo oggi.
- **Ritorno da Stripe**: `/payments/return` e `/payments/refresh` oggi navigano su `/profile`;
  navigheranno su `/store?sezione=vendita`, dove c'è lo switch da accendere.
- **Profilo**: `OnlinePaymentsCard` esce da `routes/_authenticated/profile.tsx`. Gli hook
  (`features/profile/hooks/use-online-payments.ts`) si spostano dove servono; la card in sé non
  serve più, il riquadro C2 ne prende il contenuto.
- **`OrderTypesSection`**: i tre rami sotto lo switch «Paga e ritira» (badge «Pagamenti online
  attivi» + «Gestisci nel profilo», «non più abilitati», «Attiva prima… / Vai ai pagamenti online»)
  sono sostituiti dal riquadro C2.
- **API** — unica modifica: `GET /seller/stores/:storeId/order-types` passa da `requireOwner` a
  `ensureStoreAccess` (titolare: suoi negozi; dipendente: solo negozi assegnati, 403 sugli altri),
  così la sidebar funziona anche per i dipendenti. `PATCH` resta `requireOwner`. Test di
  integrazione: dipendente assegnato → 200, non assegnato → 403, `PATCH` del dipendente → 403.

## Colore

`warning` resta il nome del token semantico; cambiano i valori. Oggi `--warning` è un ambra da testo
(`oklch(0.50 0.12 58)` chiaro, `oklch(0.78 0.14 60)` scuro) usato come `text-warning` su
`bg-warning/10–20`. Il giallo Segnale è un colore **da fondo**, su cui il testo è scuro: con lui
`text-warning` su fondo chiaro non si leggerebbe. Quindi il token diventa una coppia, come
`destructive` / `destructive-foreground`:

| token | chiaro | scuro |
|---|---|---|
| `--warning` (fondo) | `oklch(0.92 0.14 100)` | `oklch(0.37 0.08 95)` |
| `--warning-foreground` (testo e icone sul fondo) | `var(--dusk)` | `var(--cream)` |

Registrati in `@theme` come gli altri (`--color-warning`, `--color-warning-foreground`). Bordo
sottile, se serve, `border-warning-foreground/15`. I valori del fondo sono quelli della variante Y3
della preview; il bordo e l'icona ocra della preview diventano bordo derivato e icona del colore
del testo (*scelta mia*: due token invece di quattro). Contrasto del testo sul fondo da misurare in
chiaro e in scuro (AA 4.5).

**Chi usa già `warning`** e va migrato al nuovo schema «fondo giallo + testo `warning-foreground`»:

- `packages/ui/src/components/button.tsx` — variante `warning` (oggi soft: `bg-warning/10 text-warning`);
- `packages/ui/src/components/dropdown-menu.tsx` — voce `variant="warning"`: a riposo testo normale
  (un testo giallo non si legge), evidenziata con fondo `warning`; resta distinta dalla voce
  `destructive`, che rimane rossa;
- `packages/ui/src/components/alert-dialog.tsx` — media `warning` (oggi `bg-warning/15 text-warning`);
- `packages/ui/src/components/sonner.tsx` — toast `warning`, se usa il colore;
- `apps/seller/src/features/products/components/bulk-stock-adjust-dialog.tsx` — avviso con
  `border-warning/40 bg-warning/10 text-warning`.

I consumatori di `variant="warning"` in seller e admin (azioni prodotto, barra azioni di massa,
annullamento abbonamento, festività, team…) non cambiano codice ma cambiano aspetto: vanno guardati
uno per uno nel browser. `DESIGN.md`: aggiornare valori e ruolo di **Warning** (non più solo
«azioni di cautela» ma anche «c'è da fare qualcosa, non è un errore»; tonalità 95–100, oltre il
saffron 75, da cui deve restare ben distinto).

## Scelte mie (da verificare in lettura)

1. **Dettagli della chiusura.** La chiave include lo stato Stripe: se passa da `none` a
   `incomplete` il banner torna subito. Il riquadro C2 in Vendita non si chiude.
2. **Niente banner sulla scheda Vendita** (`/store` con `sezione=vendita`): lì c'è il riquadro C2
   con lo stesso pulsante, ed è dove si atterra tornando da Stripe. Su tutte le altre pagine,
   dashboard compresa, il banner c'è.
3. **Sidebar ridotta a icone**: il riquadro S2 si nasconde.
4. **Polling**: il banner nel layout non fa polling (rilegge quando la query si invalida o la
   finestra torna a fuoco); il polling ogni 10 s su `incomplete`/`in_review` resta solo nel
   riquadro C2, come faceva la card del Profilo.
5. **Dati della sidebar**: stessa query del pannello Vendita (`["store", storeId, "order-types"]`),
   così il Salva della scheda Vendita aggiorna la sidebar. Quando lo stato Stripe cambia (sync o
   polling) quella query va invalidata: `offeredOrderTypes` dipende da `chargesEnabled`.
6. **Due PR in fila.** Prima il colore (`warning` giallo in `packages/ui` + migrazione dei
   componenti sopra + `DESIGN.md`): cambia l'aspetto di flussi esistenti in admin e seller e merita
   una revisione a sé. Poi la funzione, che usa il token nuovo.
7. **Banner e fatturazione**: stesso contenitore di `StoreBillingBanner` in
   `routes/_authenticated.tsx`; se ci sono tutti e due, prima quello di fatturazione.

## Cosa resta a chi costruisce

- Struttura dei componenti, nomi dei file, chiavi dei messaggi it/en.
- Come il riquadro S2 diventa non cliccabile per il dipendente (stesso markup senza link).

## Verifica

- Test unitari della funzione che deriva cosa mostra il banner (stato Stripe + data di chiusura +
  adesso + pagina → banner sì/no e quale), compreso il ritorno dopo 7 giorni, al cambio di stato e
  l'assenza sulla scheda Vendita.
- Test di integrazione API per il guard di `GET …/order-types` (sopra).
- Aggiornare `sales-settings-panel.test.tsx` per il riquadro al posto dei vecchi link al Profilo.
- `bun run typecheck`, `bun run lint`, `bun run test` dei workspace toccati.
- PR colore: ogni consumatore di `warning` guardato in chiaro e scuro, contrasto misurato.
- PR funzione: smoke in chiaro e scuro con un titolare in ognuno dei quattro stati e un dipendente
  (vede la sidebar, non il banner, non può cliccare il riquadro). Nessun titolare del seed ha un
  account Connect: onboarding Stripe in test mode (`dev:stripe`) su titolari **di prova**, mai
  scrivendo sul seed.
- Cancellare la route `routes/pagamenti-preview.tsx` prima della PR.
