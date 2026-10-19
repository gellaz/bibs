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
- La dashboard spiega cos'è «Paga e ritira» prima di chiedere di attivarlo.
- Dopo l'attivazione, la sidebar dice per il negozio attivo se «Paga e ritira» è acceso o spento:
  l'accensione resta a mano, negozio per negozio (decisione di Marco).
- I pagamenti online hanno una sola casa: la scheda Vendita. Via la card dal Profilo.

## Non-obiettivi

- Accendere «Paga e ritira» in automatico sui negozi quando Stripe abilita l'account (Marco: no,
  lo accende il seller a mano su ogni negozio).
- Un passo nuovo nel flusso del primo negozio.
- Email o notifiche di promemoria.
- Qualsiasi modifica all'API.

## Anti-obiettivi

- Un avviso che non si può mai togliere e perseguita chi ha scelto di usare solo «Prenota e ritira».
- Due avvisi uguali sulla stessa pagina.
- Un giallo usato anche per stati neutri: il giallo vuol dire «c'è da fare qualcosa».

## Decisioni di Marco

1. **Banner in cima a ogni pagina** a stati (variante A3 della preview), nel colore **giallo
   Segnale** (Y3), non nell'ambra `warning` né in cobalto: deve saltare all'occhio. Il banner
   **sparisce quando la procedura Stripe è fatta** (account abilitato); non ha uno stato «ora
   accendilo nel negozio».
2. **Card in dashboard** (variante B2) sopra i «Da fare», sotto la striscia delle statistiche.
   Un'unica sezione (`rounded-xl border bg-card p-6`), due colonne da `sm` (`grid sm:grid-cols-[1fr_auto]`),
   una sotto l'altra su mobile:
   - a sinistra: occhiello mono maiuscolo «Da attivare»; titolo display «Sblocca «Paga e ritira»»;
     un elenco puntato semplice (testo `muted`, niente icone, niente card) con tre righe:
     «Il cliente paga subito: meno prenotazioni non ritirate.» · «Stripe ti versa gli incassi sul
     conto.» · «Pochi minuti: dati dell'attività, documento e IBAN.»; poi i pulsanti
     «Attiva pagamenti online» (primario) e «Più tardi» (ghost);
   - a destra (larga `w-64` da `sm`): un riquadro `bg-background` con etichetta «Come comprano i tuoi
     clienti» e due righe nome + `StatusBadge`: «Prenota e ritira» `success` «Attivo», «Paga e
     ritira» `action` «Da attivare».

   Nella preview la card aveva fondo `bg-card`; con la scelta del giallo Segnale prende fondo e bordo
   `notice` negli stati gialli (vedi tabella). In `incomplete` occhiello «Da completare», pulsante
   «Completa l'attivazione».
3. **Riquadro in Vendita** (variante C2) sotto lo switch «Paga e ritira», nei quattro stati: prende
   il posto della card del Profilo, che **sparisce dal Profilo**. Forma: una riga
   `flex flex-wrap items-center gap-3 rounded-md border p-3` dentro la sezione «Tipologie
   d'acquisto», con a sinistra lo `StatusBadge` dello stato (stessi toni e icone di `STATUS_BADGE`
   in `online-payments-card.tsx`), al centro il testo `text-sm muted` (più una riga `text-xs` per
   l'avviso versamenti), a destra i pulsanti (`size="sm"`: «Aggiorna stato» outline, poi il
   primario). Negli stati gialli fondo e bordo `notice`, negli altri solo `border`.
4. **Sidebar** (variante S2): un riquadro in fondo alla sidebar, sopra l'utente, «Come comprano i
   clienti», con una riga per tipologia: pallino pieno verde + «attivo», oppure pallino vuoto +
   «spento». È lui a segnalare, dopo l'attivazione, che in un negozio «Paga e ritira» non è acceso.

## Stati

Lo stato viene da `GET /seller/settings` → `onlinePayments.status` (`none` · `incomplete` ·
`in_review` · `enabled`), già esposto e già usato dalla card del Profilo.

| Stato | Banner (tutte le pagine) | Card B2 (dashboard) | Riquadro C2 (Vendita) |
|---|---|---|---|
| `none` | giallo · ««Paga e ritira» è spento. Attiva i pagamenti online: i clienti pagano dall'app e passano solo a ritirare.» · **Attiva** | giallo, completa, **Attiva pagamenti online** | giallo · badge «Da attivare» · **Attiva pagamenti online** |
| `incomplete` | giallo · «Attivazione a metà. Mancano alcuni dati su Stripe per accendere «Paga e ritira».» · **Completa** | giallo, **Completa l'attivazione** | giallo · badge «Da completare» · **Aggiorna stato** + **Completa l'attivazione** |
| `in_review` | neutro (bordo, fondo card) · «Stripe sta verificando i tuoi dati. Quando ha finito potrai accendere «Paga e ritira» nelle impostazioni del negozio.» · nessun pulsante | neutra (`bg-card`), occhiello «In verifica», senza pulsanti | neutro · badge «In verifica» · **Aggiorna stato** |
| `enabled` | non c'è | non c'è | neutro · badge «Pagamenti online attivi» · «Vale per tutti i tuoi negozi.» · se `!payoutsEnabled` anche «I versamenti sul tuo conto partono appena Stripe completa la verifica.» |

I testi sono le bozze della preview; quelli già esistenti in `messages/*.json` (`payments_*`) si
riusano dove dicono la stessa cosa. Se Stripe in seguito disabilita l'account, lo stato torna
indietro e banner e card ricompaiono da soli.

**Sidebar S2** — mostra `offeredOrderTypes` del negozio attivo (ciò che il cliente vede davvero al
checkout), non `orderTypes`: se «Paga e ritira» è configurato ma l'account non incassa, risulta
«spento». Il riquadro è un link a `/store?sezione=vendita`. Colori neutri (verde `success` per
«attivo», `muted` per «spento»): niente giallo in sidebar.

## Comportamento

- **Pulsanti Attiva / Completa** (banner, card, riquadro): chiamano `useStartOnboarding()` e vanno
  dritti su Stripe, come il pulsante del Profilo oggi.
- **Ritorno da Stripe**: `/payments/return` e `/payments/refresh` oggi navigano su `/profile`;
  navigheranno su `/store?sezione=vendita`, dove c'è lo switch da accendere.
- **Profilo**: `OnlinePaymentsCard` esce da `routes/_authenticated/profile.tsx`. Componente e hook
  (`features/profile/components/online-payments-card.tsx`, `features/profile/hooks/use-online-payments.ts`)
  si spostano dove servono (feature `stores` o una feature `online-payments`); la card in sé non
  serve più, il riquadro C2 ne prende il contenuto.
- **`OrderTypesSection`**: i tre rami sotto lo switch «Paga e ritira» (badge «Pagamenti online
  attivi» + «Gestisci nel profilo», «non più abilitati», «Attiva prima… / Vai ai pagamenti online»)
  sono sostituiti dal riquadro C2. Il caso «Paga e ritira configurato ma account non più
  abilitato» (oggi `store_order_types_pay_account_disabled`) va tenuto: il riquadro torna giallo
  nello stato corrispondente e lo switch acceso lo dice.

5. **Chiusura degli avvisi** (scelta di Marco): la X del banner e il «Più tardi» della card
   nascondono l'avviso **per 7 giorni su quel computer** (`localStorage` con la data di chiusura,
   letture e scritture in try/catch; se lo storage non c'è l'avviso si vede). Niente opt-out
   definitivo né sincronizzato tra dispositivi: richiederebbe l'API.

## Scelte mie (da verificare in lettura)

1. **Dettagli della chiusura.** La chiave include lo stato Stripe: se passa da `none` a
   `incomplete` l'avviso torna subito. Banner e card hanno chiavi separate. Il riquadro C2 in
   Vendita non si chiude.
2. **Niente doppioni**: il banner non compare su `/` (c'è la card B2) né sulla scheda Vendita
   (`/store` con `sezione=vendita`, c'è il riquadro C2 con lo stesso pulsante; è anche dove si
   atterra tornando da Stripe). Sulle altre schede di `/store` il banner c'è.
3. **Solo il titolare** vede banner, card e riquadro in sidebar. `GET /seller/settings` dà
   `onlinePayments` solo al titolare e `GET /seller/stores/:storeId/order-types` è
   `requireOwner`: estenderli ai dipendenti vorrebbe dire toccare l'API, e il dipendente vede già il
   tipo su ogni ordine.
4. **Sidebar ridotta a icone**: il riquadro S2 si nasconde (`group-data-[collapsible=icon]:hidden`
   o equivalente del componente sidebar).
5. **Polling**: il banner nel layout non fa polling (rilegge solo quando la query si invalida o la
   finestra torna a fuoco); il polling ogni 10 s su `incomplete`/`in_review` resta solo nel
   riquadro C2 in Vendita, come faceva la card del Profilo. Un `in_review` può durare giorni: un
   polling su ogni pagina sarebbe spreco.
6. **Dati della sidebar**: stessa query del pannello Vendita (`["store", storeId, "order-types"]`),
   così il Salva della scheda Vendita aggiorna la sidebar senza codice in più. Quando lo stato
   Stripe cambia (sync o polling), quella query va invalidata: `offeredOrderTypes` dipende da
   `chargesEnabled`.
8. **Sidebar sempre visibile al titolare**, in ogni stato Stripe: dice com'è il negozio, in modo
   neutro, quindi prima dell'attivazione mostra «Paga e ritira — spento» come dopo. Il segnale
   giallo resta a banner e card; la sidebar diventa l'unico promemoria quando quelli spariscono.
7. **Token colore.** Il giallo Segnale entra nel design system come tre token theme-aware in
   `packages/ui/src/styles/globals.css`, registrati in `@theme` come gli altri, e descritti in
   `DESIGN.md` (sezione colori di stato):

   | token | chiaro | scuro |
   |---|---|---|
   | `--notice` (fondo) | `oklch(0.92 0.14 100)` | `oklch(0.37 0.08 95)` |
   | `--notice-border` | `oklch(0.83 0.16 95)` | `oklch(0.55 0.11 95)` |
   | `--notice-icon` | `oklch(0.55 0.13 80)` | `oklch(0.92 0.16 100)` |

   Il testo sopra è `foreground`. Il nome è libero; il ruolo è «c'è da fare qualcosa, non è un
   errore», distinto da `warning` (azioni di cautela) e da `action` (badge «tocca a te»). Il
   contrasto del testo `foreground` sul fondo va misurato in chiaro e in scuro (AA 4.5).

## Cosa resta a chi costruisce

- Struttura dei componenti (un `OnlinePaymentsNotice` per stato riusato da banner/card/riquadro, o
  componenti separati), nomi dei file, chiavi dei messaggi it/en.
- Il layout esatto della card B2 sugli schermi stretti (nella preview: due colonne da `sm`, il
  riquadro «Come comprano» va sotto su mobile).
- La posizione del banner: lo stesso contenitore di `StoreBillingBanner` in
  `routes/_authenticated.tsx`. Se ci sono tutti e due, prima quello di fatturazione (è più grave).

## Verifica

- Test unitari della funzione che deriva lo stato mostrato (stato Stripe + data di chiusura +
  adesso → cosa mostrare, compreso il ritorno dopo 7 giorni e al cambio di stato) e della regola
  «niente banner su `/` e sulla scheda Vendita».
- Aggiornare `sales-settings-panel.test.tsx` per il riquadro al posto dei vecchi link al Profilo.
- `bun run typecheck`, `bun run lint`, `bun run test` dei workspace toccati.
- Smoke nel browser in chiaro e scuro, con un titolare in ognuno dei quattro stati, più un
  dipendente che non deve vedere nulla. Nessun titolare del seed ha un account Connect: si fa
  l'onboarding Stripe in test mode (`dev:stripe`) su titolari **di prova**, mai scrivendo sul seed.
- Cancellare la route `routes/pagamenti-preview.tsx` prima della PR.
