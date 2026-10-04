# Locale `en` raggiungibile nei tre frontend — design

**Date:** 2026-10-04
**Status:** approved
**Riferimenti:** i riferimenti `file:riga` puntano a `main` @ `cc22633`
**Backlog:** chiude la voce P4 «Locale `en` irraggiungibile» di
[`docs/audit/2026-09-24-followup-gap-analysis.md`](../../audit/2026-09-24-followup-gap-analysis.md)

## Problema

I tre FE compilano Paraglide con `strategy: ["url", "baseLocale"]` (`vite.base.ts:38-42` e lo
script `paraglide:compile` di ogni `package.json`), ma nessuno è cablato:

- `router.tsx` (identico nelle 3 app) non ha `rewrite`, e non esiste un `src/server.ts` con
  `paraglideMiddleware`: `/en/login` dà 404 e `en.json` non viene mai servito;
- `<html lang={getLocale()}>` in SSR è sempre `it`; `beforeLoad` di `__root.tsx:26-30` lo
  corregge solo lato client;
- seller (`components/nav-user.tsx:119-150`, bandierine) e admin
  (`components/locale-switcher.tsx`, globo) hanno già un selettore: `setLocale("en")` porta a
  `/en/...`, cioè al 404. Il customer non ne ha;
- il customer in inglese mostrerebbe comunque italiano: ~9 stringhe residue, `ThemeToggle` e
  `PasswordInput` di `packages/ui` hardcoded, prezzi e date fissi a `it-IT`.

## Decisioni

1. **Lingua nel cookie, non nell'URL.** Strategia `["cookie", "baseLocale"]`. Tutte e tre le
   app sono dietro login (il customer intero sta sotto `_authenticated/`): niente SEO da
   servire, e un link condiviso non deve imporre la lingua di chi lo manda. Il cookie evita
   `rewrite`, `localizeHref` sui callback di better-auth e link email con prefisso.
   Limite accettato: la scelta vale per browser e per host. Su host diversi ogni app ha il
   suo cookie; in dev (`localhost:3001/3002/3003`) i cookie non distinguono la porta, quindi
   la lingua scelta in un'app vale anche per le altre due.
2. **Niente `preferredLanguage`.** Molti italiani hanno il dispositivo in inglese: si parte
   sempre dall'italiano, l'inglese solo per scelta esplicita.
3. **`en` compilato in tutte e 3 le app**, selettore **visibile solo nel customer**. In seller e
   admin il selettore si mostra solo in dev (`import.meta.env.DEV`), così le PR di traduzione
   si provano senza toccare la config; nelle build di produzione non c'è finché la traduzione
   non è completa (seller ~450 stringhe in ~75 file, admin ~350 in ~45).
4. **Selettore nel menu utente, e nel customer anche sulle pagine auth** (login, register,
   forgot-password, reset-password, verify-email), dove il menu non c'è.
5. **Formattazione che segue la lingua**: `it` → `it-IT`, `en` → `en-GB` («€12.50»,
   «04/10/2026»), sempre in euro.

## Design

### 1. Cablaggio (3 app)

- `vite.base.ts` e `paraglide:compile`: `strategy: ["cookie", "baseLocale"]`.
- `src/server.ts` nuovo in ogni app, dalla doc Paraglide per TanStack Start:

  ```ts
  import handler from "@tanstack/react-start/server-entry";
  import { paraglideMiddleware } from "./paraglide/server.js";

  export default {
  	fetch(req: Request): Promise<Response> {
  		return paraglideMiddleware(req, () => handler.fetch(req));
  	},
  };
  ```

  Il middleware legge il cookie e mette la locale in AsyncLocalStorage per la durata del
  render: `getLocale()` in SSR è quello della richiesta, quindi `<html lang>` e i testi sono
  giusti dal primo byte. Senza strategia `url` non riscrive né redirige.
- `__root.tsx`: via il `beforeLoad` del lang (ridondante: `setLocale` ricarica la pagina).
- `router.tsx` non cambia.

### 2. `LocaleToggle` condiviso

`packages/ui/src/custom/locale-toggle.tsx`, segmentato come `ThemeToggle` (stesso
`segmentedTrayClassName`), etichette in testo «IT» / «EN» con nome per esteso in
`aria-label`/`title` (niente bandiere: indicano paesi, non lingue). Il runtime Paraglide è di
ogni app, quindi il componente è puro:

```ts
interface LocaleToggleProps<L extends string> {
	locales: readonly L[];
	value: L;
	onChange: (locale: L) => void;
	labels: { group: string; names: Record<L, string> };
}
```

In implementazione i nomi delle lingue sono nativi («Italiano», «English») e non si
traducono: stanno in una costante del componente, che riceve solo `label` invece di
`labels.names`.

Non renderizza nulla con una sola locale. Usi:

- **customer**: `components/user-menu.tsx` sotto `ThemeToggle`; un piccolo
  `components/auth-locale-footer.tsx` in fondo alle 5 pagine auth;
- **seller**: sostituisce il `ToggleGroup` a bandierine in `nav-user.tsx` (via
  `LOCALE_FLAGS`/`LOCALE_NAMES`), solo in dev;
- **admin**: sostituisce `components/locale-switcher.tsx` (eliminato) in `nav-user.tsx`, solo
  in dev.

`onChange` chiama `setLocale(locale)`: scrive `PARAGLIDE_LOCALE` e ricarica.

### 3. Formattazione per lingua

`packages/ui` non può importare il runtime delle app. Nuovo `packages/ui/src/lib/intl-locale.ts`:

```ts
export function setIntlLocaleResolver(resolve: () => string): void;
export function intlLocale(): string; // default "it-IT"
```

Ogni app registra il resolver una volta, a livello di modulo in `router.tsx`:
`setIntlLocaleResolver(() => (getLocale() === "en" ? "en-GB" : "it-IT"))`. Il resolver legge
`getLocale()` a ogni chiamata, quindi in SSR rispetta la richiesta corrente (AsyncLocalStorage)
anche con richieste concorrenti in lingue diverse.

- `formatPriceEur` (`custom/price.tsx`) usa `intlLocale()` con un formatter in cache per
  locale; il commento «convenzione italiana» diventa «secondo la lingua dell'utente».
- `formatDateIt` (`lib/date.ts`) diventa `formatDate` con `intlLocale()`; rinomina meccanica
  nei 5 file che lo usano (tutti in seller e admin: lì segue la lingua solo quando la si
  sceglie in dev).
- I 7 `it-IT` del customer passano a `intlLocale()`: `features/products/format-characteristic.ts`,
  `features/stores/open-status.ts`, `features/orders/order-display.ts`,
  `routes/_authenticated/points.tsx`, `orders/index.tsx`, `orders/$orderId.tsx`,
  `checkout/$checkoutId/pay.tsx`. `features/profile/profile-identity.tsx` usa già una mappa
  sua: passa a `intlLocale()`.
- I `it-IT` di seller e admin restano: si sistemano con le rispettive traduzioni.

### 4. Stringhe residue del customer

- `routes/__root.tsx`: «Pagina non trovata», «Torna alla home» → `m.*`.
- `features/stores/store-cover.tsx`: «Negozi» → `m.*`.
- `features/stores/open-status.ts`: «Aperto», «Chiuso», «apre alle…», «Orari non indicati»…
  → `m.*` con parametri.
- `ThemeToggle` e `PasswordInput`: prop `labels` opzionale con l'italiano attuale come default
  (stesso schema di `MunicipalityCombobox`); il customer passa le chiavi Paraglide, seller e
  admin restano sui default.
- I `throw new Error("Caricamento … non riuscito")` degli hook non arrivano alla UI (che
  mostra `m.*`): restano.

Tutte le chiavi nuove in `it.json` ed `en.json`.

## Fuori scope (residui nell'audit)

- Traduzione di seller e admin (stringhe, `it-IT`, `Calendar` senza `locale`, stringhe di
  `packages/ui` usate solo lì: `TableColumnsToggle`, `DataPagination`, `PageSizeSelector`,
  `CopyButton`).
- `user.locale` nel DB: preferenza che segue l'utente su ogni dispositivo e permette email ed
  errori API nella sua lingua. Il cookie resta come cache lato client.
- Errori API: sono in italiano anche con UI in inglese.
- Messaggi 422 di Elysia/TypeBox in inglese: PR a parte con traduzione centralizzata
  nell'error-handler per tipo di errore TypeBox.
- Email solo in italiano.

## Verifica

- **Vitest**: `LocaleToggle` (jsdom: niente render con una locale, `onChange` alla scelta,
  `aria-label`); `intl-locale` (default `it-IT`, resolver registrato); `formatPriceEur` e
  `formatDate` in entrambe le lingue; `open-status.test.ts` aggiornato.
- `bun run test`, typecheck, `vite build` delle 3 app.
- **Curl SSR** su :3001, :3002, :3003: `/login` senza cookie → `<html lang="it">`;
  con `Cookie: PARAGLIDE_LOCALE=en` → `<html lang="en">` e, sul customer, testo in inglese.
- **Smoke guidato**: customer, cambio lingua da login e da menu utente, navigazione, prezzi e
  date, ritorno a italiano; seller/admin in dev, selettore presente e funzionante.
- Audit aggiornato nella stessa PR: voce in «Chiusi», residui sopra in P4.
