# Onboarding seller: atterraggio dopo la verifica email e documento d'identità — design

**Date:** 2026-10-13
**Status:** in revisione
**Riferimenti:** i percorsi puntano a `main` @ `aca61ac` (dopo #267).

## Problema

1. **Dopo il click sul link di verifica email il seller non sa cosa fare.** better-auth verifica
   e reindirizza a `${SELLER_APP_URL}/login` (`callbackURLForRole` in
   `apps/api/src/modules/registration/services.ts`). Il login non dice niente: sembra un nuovo
   accesso qualunque, non il passo che sblocca la registrazione.
2. **La scadenza del documento non è controllata.** `DocumentBody`
   (`apps/api/src/lib/schemas/forms/onboarding.ts`) valida solo il formato `AAAA-MM-GG`: un
   documento scaduto passa.
3. **La foto caricata non si vede.** Il `Dropzone` in
   `apps/seller/src/routes/_authenticated/onboarding/document.tsx` mostra solo «caricato».
4. **Il tipo di documento non esiste.** Il form presume la carta d'identità; il numero accetta
   5–20 caratteri qualsiasi.

## Decisioni di prodotto

1. **Il link è quello di verifica email** (dopo la registrazione). Oggi non parte nessuna email
   all'approvazione admin, e non se ne aggiunge una.
2. **Solo documenti italiani.** Coerente con il «comune di emissione», già obbligatorio e italiano.
3. **Tre tipi:** carta d'identità, patente, passaporto.
4. **Il secondo login resta.** Niente `autoSignInAfterVerification`: è globale (cambierebbe anche
   il customer) e farebbe entrare chiunque abbia il link. Basta spiegare cosa succede.

## Design

### 1. Atterraggio dopo la verifica email

- `callbackURL` del seller → `${SELLER_APP_URL}/login?verified=1`. Tre punti:
  - `callbackURLForRole("seller")` in `apps/api/src/modules/registration/services.ts`;
  - il re-invio in `apps/seller/src/routes/verify-email.tsx`;
  - il re-invio in `apps/seller/src/features/auth/components/pending-verification-banner-connected.tsx`.
  Il customer non cambia.
- `apps/seller/src/routes/login.tsx` dichiara `validateSearch` (zod, come `verify-email.tsx`) con
  `verified` e `error`, entrambi opzionali e tolleranti (`.catch(undefined)`).
  - `verified` → banner di successo sopra il form: «Email confermata! Accedi per continuare la
    registrazione: ti chiederemo dati anagrafici, documento e dati dell'azienda.»
  - `error` → banner d'errore: «Il link non è più valido. Accedi: ti mandiamo una nuova email.»
    better-auth 1.7.7 aggiunge `error=TOKEN_EXPIRED` / `INVALID_TOKEN` / `USER_NOT_FOUND` al
    `callbackURL` con `appendQueryParams`, quindi l'URL diventa `/login?verified=1&error=…`:
    **`error` vince su `verified`**. Il re-invio non serve costruirlo: il login con email non
    verificata risponde 403 e mostra già il banner con il link a `/verify-email`.
  - Utente già verificato che riclicca il link: better-auth reindirizza al `callbackURL` senza
    errore → banner di successo. Va bene.
- Stile del banner: lo stesso blocco `rounded-md px-3 py-2 text-sm` del banner «email non
  verificata» già in `login.tsx`, con i token di successo/errore del seller.
- Messaggi nuovi in `apps/seller/messages/{it,en}.json`.

### 2. Tipo di documento

**DB.** `seller_profiles.document_type`:
`text("document_type", { enum: ["identity_card", "driving_license", "passport"] })` + CHECK
`seller_profile_document_type_valid` (convenzione `text({ enum })` + CHECK, non `pgEnum`).
Nullable come gli altri campi documento (si compilano allo step 2). Migrazione con
`bun run db:generate`; l'app non è in produzione.

**Contratto API.**
- `DocumentBody` riceve `documentType`: `Type.Union` dei tre literal, errore «Seleziona il tipo
  di documento». `documentNumber` resta `minLength 5 / maxLength 20` (barriera grezza); il formato
  per tipo lo controlla il modulo del § 3.
- `DocumentChangeBody` (`forms/settings.ts`) è `= DocumentBody`: la richiesta di cambio documento
  lo eredita. Anche `StoredDocumentChange` (approvazione admin) lo eredita.
- `SellerProfileSchema` (`lib/schemas/entities.ts`) espone `documentType: t.Nullable(...)`.
- Le route passano `documentType` al servizio: `updateDocument` (onboarding) e la richiesta di
  cambio documento (`seller/routes/settings.ts` → `services/settings.ts`).
- Redazione per i dipendenti (`services/settings.ts`, blocco che azzera `documentNumber` & co.):
  aggiungere `documentType: null`.
- Admin: dettaglio venditore (`apps/admin/src/routes/_authenticated/sellers/$sellerId.tsx`,
  sezione documento) mostra il tipo come prima riga, con le etichette in
  `apps/admin/messages/{it,en}.json`. Il servizio admin (`getSellerDetail` & co.) già spalma
  `...rest` del profilo: verificare che il campo arrivi senza toccarlo.
- La pagina profilo del seller non mostra dati del documento: niente da cambiare.

**Seed.** `fixtures/dev-seller.ts` e `fixtures/sellers.ts` impostano `documentType` dove c'è il
documento. I numeri attuali `AX0000001`… (2 lettere + 7 cifre) sono validi come carta
d'identità e come passaporto: assegnare i tipi a rotazione con numeri coerenti al tipo.

### 3. Regole su numero e scadenza (modulo condiviso)

Un modulo puro in `apps/api/src/lib/schemas/forms/identity-document.ts`, riesportato da
`forms/index.ts` (cioè da `@bibs/api/schemas`, già importato dal form seller):

```ts
export const IDENTITY_DOCUMENT_TYPES = ["identity_card", "driving_license", "passport"] as const;
// Non `DocumentType`: è già un'interfaccia globale del DOM.
export type IdentityDocumentType = (typeof IDENTITY_DOCUMENT_TYPES)[number];

/** Esempio per tipo: placeholder dell'input e messaggio d'errore. */
export const DOCUMENT_NUMBER_EXAMPLES: Record<IdentityDocumentType, string>;

/** Maiuscolo, solo lettere e cifre: «ca 12345-ab» → «CA12345AB». */
export function normalizeDocumentNumber(value: string): string;

/** true se il numero (già normalizzato) ha un formato ammesso per il tipo. */
export function isValidDocumentNumber(type: IdentityDocumentType, normalized: string): boolean;

/** true se la scadenza (AAAA-MM-GG) è prima di `today` (AAAA-MM-GG). */
export function isDocumentExpired(expiry: string, today: string): boolean;

/** Data di oggi a Roma, AAAA-MM-GG. */
export function todayInRome(now?: Date): string;
```

Il modulo restituisce booleani, non messaggi: l'API scrive i suoi in italiano (sono i 422), il
seller usa i messaggi paraglide, quindi anche in inglese.

Formati (sul numero normalizzato):

| Tipo | Pattern | Esempio |
|---|---|---|
| Carta d'identità | `^[A-Z]{2}\d{5}[A-Z]{2}$` (CIE) oppure `^[A-Z]{2}\d{7}$` | `CA12345AB`, `AX1234567` |
| Patente | `^U1[A-Z0-9]{7}[A-Z]$` (modello UE dal 2013) oppure `^[A-Z]{2}\d{7}[A-Z]$` | `U1T86I309C`, `MI1234567A` |
| Passaporto | `^[A-Z]{2}\d{7}$` | `YA1234567` |

- La carta cartacea (2 lettere + 7 cifre) non vale più dal 3 agosto 2026 (Reg. UE 2019/1157), ma
  il formato resta accettato: costa poco e non rischia di bloccare una CIE di vecchia
  generazione. L'admin vede comunque la foto.
- I formati vengono da fonti secondarie: commento `ponytail:` sopra i pattern («fonti non
  ufficiali; se un documento vero viene rifiutato, allarga il pattern»).
- Messaggi: «Numero del documento non valido per il tipo scelto (es. CA12345AB)» (esempio del
  tipo scelto), «Il documento è scaduto».
- Scadenza: valido se `expiry >= today`; scade oggi = ancora valido. Confronto tra stringhe
  `AAAA-MM-GG`.
- «Oggi» = `todayInRome()` (`Intl.DateTimeFormat` con `timeZone: "Europe/Rome"`), lo stesso su
  API e seller: vicino alla mezzanotte il form e il server non danno risposte diverse.

**Dove si applicano.**
- **API** — in `updateDocument` (`seller/services/onboarding.ts`) e nella richiesta di cambio
  documento (`seller/services/settings.ts`), prima dell'upload su S3: normalizza il numero,
  poi `ServiceError(422, messaggio)` se il numero non è valido per il tipo o il documento è
  scaduto. Salva il numero normalizzato.
- **Seller** — in `onSubmit` di `document.tsx`, prima della mutation: stesse funzioni, errore con
  `setError` sul campo (`documentNumber` o `documentExpiry`), così compare sotto l'input come gli
  errori di schema. Il resolver TypeBox resta com'è.
- L'approvazione admin di un cambio documento ricontrolla solo lo schema (come oggi): numero e
  scadenza sono stati controllati alla richiesta. `approveChange`
  (`admin/services/sellers.ts`) applica i campi uno per uno: aggiungere `documentType`.

### 4. Form documento (seller)

In `apps/seller/src/routes/_authenticated/onboarding/document.tsx`:

- **Select del tipo** come primo campo (`Controller` + `Select` di `@bibs/ui`), etichette
  «Carta d'identità», «Patente», «Passaporto». Nessun default: il seller sceglie.
- **Placeholder del numero** dall'esempio del tipo scelto (`CA12345AB` se non ancora scelto).
- **Scadenza**: `min={oggi}` sull'input date.
- **Anteprima foto**: `URL.createObjectURL(documentImage)` in un `useEffect` che ritorna
  `revokeObjectURL`; lo stato dell'URL vive accanto a `documentImage`. Dentro `DropzoneContent`
  l'`<img>` prende il posto dell'icona: `alt` «Anteprima del documento», `max-h-48 w-auto
  object-contain rounded-md`. Sotto restano «Clicca o trascina per sostituire». Niente ref letti
  in render (React Compiler).
- La descrizione dello step (`onboarding_document_description`, oggi «Carica la tua carta
  d'identità») diventa «Carica un documento d'identità». Anche `description` di `t.File` nella
  route (`seller/routes/onboarding.ts`) e di `documentNumber` in `DocumentBody` passano a
  «documento d'identità». L'etichetta del numero è già «Numero documento».

## Test

- **Unit** `apps/api/tests/lib/identity-document.test.ts`: per ogni tipo un numero valido e uno
  non valido (anche quello valido per un altro tipo, es. `U1T86I309C` come passaporto);
  normalizzazione di spazi e minuscole; scadenza ieri / oggi / domani.
- **Integration** `apps/api/tests/integration/seller-onboarding-document.test.ts` sulla route
  `PATCH …/seller/onboarding/document`: 422 con documento scaduto, 422 con numero incoerente col
  tipo, 200 che salva `documentType` e il numero normalizzato. S3 come in
  `seller-product-images.test.ts`.
- **Integration** cambio documento (`seller-settings-change-requests.test.ts`): 422 su documento
  scaduto.
- **Da aggiornare**: i test che costruiscono un body documento o un `changeData` documento senza
  `documentType` (`admin-sellers.test.ts`, `date-format.test.ts`,
  `seller-settings-owner-only.test.ts`, `seller-settings-employee-redaction.test.ts`,
  `registration-response-schema.test.ts`).
- **Seller** (Vitest): test del login che mostra il banner giusto per `verified`, `error` e
  entrambi.
- **Gate**: `bun run typecheck`, `bun run lint`, `bun run test` (suite completa, `--isolate`),
  `bun run build` del seller; smoke manuale di Marco su registrazione → link → login →
  step documento (tre tipi, documento scaduto, anteprima, sostituzione foto) e dettaglio admin.

## Fuori scope

- Documenti esteri e paese di emissione.
- Email «account approvato» all'approvazione admin.
- UI seller per la richiesta di cambio documento (oggi esiste solo l'API).
- Controllo di scadenza al momento dell'approvazione admin o durante la vita dell'account.

## Rischi

- **Formati non ufficiali**: un documento vero con un formato non previsto viene rifiutato.
  Provare con patente e passaporto reali prima del merge; il pattern si allarga in un punto solo.
- **Richieste di cambio documento già pendenti** senza `documentType` non passano più la
  validazione all'approvazione. App non in produzione: accettato.
