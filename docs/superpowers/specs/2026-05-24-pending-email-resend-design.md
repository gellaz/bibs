# Resend del link di verifica per email "pending" durante la registrazione

**Data**: 2026-05-24
**Scope**:
- `apps/api/src/modules/registration/services.ts` (riscrittura del check duplicato in `registerUser`)
- `apps/api/src/lib/errors.ts` o equivalente (nuovo error code `EMAIL_PENDING_VERIFICATION`)
- `apps/api/src/modules/registration/routes.ts` (annotazioni OpenAPI sui due endpoint `/register/*`)
- `apps/seller/src/routes/register.tsx` + `apps/customer/src/routes/register.tsx` (handling del nuovo error code, render del banner connector)
- `apps/seller/src/routes/verify-email.tsx` + gemello customer (cooldown 60s + feedback su "Re-invia")
- `apps/seller/src/components/auth/pending-verification-banner-connected.tsx` + gemello customer (wrapper i18n + authClient)
- `packages/ui/src/components/pending-verification-banner.tsx` (nuovo, presentational — path **flat**, niente subdir `auth/`, perché `packages/ui/package.json` esporta `"./components/*": "./src/components/*.tsx"` con wildcard a un solo livello)
- `packages/ui/src/hooks/use-cooldown.ts` (nuovo, riusabile — esportato via `"./hooks/*": "./src/hooks/*.ts"`)
- Drizzle migration: aggiungere `.onDelete("cascade")` a `verification.userId` in `apps/api/src/db/schemas/auth.ts` (oggi NON ha cascade, vedi sezione Cascade FK)
- Stringhe Paraglide in `apps/{seller,customer}/messages/*.json`

**Out of scope**:
- Cron / job di cleanup periodico dei `user` non verificati. Il cleanup è inline al signup (TTL 7gg). Valutare un cron quando bibs sarà in produzione con traffico reale.
- Rate limit dedicato per `/api/auth/send-verification-email` oltre al default Better Auth (10 req / 10s).
- CAPTCHA / Turnstile sul form di registrazione.
- Cambi al flusso di login, forgot-password, reset-password.
- Hardening anti-enumeration (oggi il messaggio "email pending" rivela che la mail era stata usata: trade-off accettato, è coerente con il login).
- Frontend `admin` (non ha self-signup).
- Cambi al DB schema (tutte le colonne necessarie esistono già: `user.emailVerified`, `user.createdAt`).

## Obiettivo

Sbloccare l'utente che si è registrato, non ha cliccato il link di verifica e prova a registrarsi di nuovo. Oggi questo scenario lo blocca **permanentemente**: il backend ritorna un `409 EMAIL_ALREADY_REGISTERED` indistinguibile dal caso "account verificato esistente", e il form di registrazione non offre nessuna via di uscita.

Il fix introduce:
1. Un **codice di errore distinto** `EMAIL_PENDING_VERIFICATION` (409) che il backend ritorna quando l'email esiste ma `emailVerified = false` e il record è entro 7 giorni.
2. Un **re-invio automatico** del link di verifica contestuale a quell'errore (l'utente riceve subito una nuova mail senza dover cliccare niente).
3. Un **banner inline** sul form di registrazione che spiega cosa è successo e offre: Re-invia link manuale (cooldown 60s) / Ho dimenticato la password / Usa un'altra email.
4. Un **cleanup on-demand**: se l'email pending è più vecchia di 7 giorni, il record viene cancellato in cascade e il signup procede come nuovo (con la password appena inserita).

Effetto netto: nessun utente resta bloccato. La sicurezza è preservata (niente sovrascrittura silente di account altrui non verificati).

## Decisioni chiave (negoziate in brainstorming)

| Tema | Decisione |
|---|---|
| Strategia UX su re-signup | **Opzione "Inline re-invia link"**: il backend re-invia il link di verifica al posto di sovrascrivere o ignorare. La password appena inserita viene scartata. L'account originale resta intatto. |
| Caveat password dimenticata | Banner offre anche link "Ho dimenticato la password" → `/forgot-password?email=…`. Edge case raro (minuti dall'inserimento) ma coperto. |
| Scope app | Seller **e** customer. La funzione `registerUser` è condivisa nel modulo `registration`, e i due flow frontend hanno UX gemella. |
| Cleanup record vecchi | **On-demand inline, TTL 7gg**. Niente cron. Quando un signup duplicato trova un record pending più vecchio di 7gg, lo cancella in cascade e procede come nuovo signup. |
| Rate limit resend | **Cooldown UI 60s + default Better Auth** (10 req / 10s su `/api/auth/send-verification-email`). Nessun rate limit dedicato extra. |
| Banner componente | **Presentational in `packages/ui`** (zero dipendenze auth/i18n) + **connector wrapper in ogni app** (passa labels Paraglide e callback `authClient`). |
| Hook `useCooldown` | In `packages/ui/src/hooks/` per riuso futuro (OTP, reset password). |
| Error code shape | Status `409` per entrambi `EMAIL_ALREADY_REGISTERED` e `EMAIL_PENDING_VERIFICATION` (stessa famiglia Conflict), discriminati dal `code`. Coerente col pattern `ServiceError(status, message)` di bibs (FE discrimina via status+code). |
| Payload `EMAIL_PENDING_VERIFICATION` | Include `resentAt: ISO timestamp` per inizializzare il cooldown del banner senza una seconda round-trip. |
| Side effect "re-invia" automatico | Quando il backend ritorna `EMAIL_PENDING_VERIFICATION`, ha **già chiamato** `auth.api.sendVerificationEmail`. Se l'invio mail interno fallisce, log + ritorna comunque l'errore (no leak di errori delivery al client). |
| Anti-takeover | Mai update di record `user` esistenti. Solo branch "ritorna errore" o "delete cascade + insert nuovo". Garantisce che chi non controlla l'inbox non possa mai sovrascrivere account altrui. |
| OpenAPI | Entrambi i 409 vanno dichiarati in `withErrors(...)` nelle route `/register/seller` e `/register/customer` con descrizione italiana. |

---

## Architettura — Backend

### Riscrittura di `registerUser` in `apps/api/src/modules/registration/services.ts`

Oggi (`services.ts:35-40`) il check è:
```ts
const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
if (existing.length > 0) {
  throw new ServiceError(409, "Email già registrata");
}
```

Diventa una funzione `resolveExistingUser(email)` con tre rami espliciti, eseguita **dentro una transazione** insieme all'eventuale signup:

```ts
type ExistingDecision =
  | { kind: "none" }
  | { kind: "verified-conflict"; user: User }
  | { kind: "pending-resend"; user: User }
  | { kind: "pending-expired"; user: User };

const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function decideExisting(row: User | null, now: number): ExistingDecision {
  if (!row) return { kind: "none" };
  if (row.emailVerified) return { kind: "verified-conflict", user: row };
  const age = now - new Date(row.createdAt).getTime();
  return age < PENDING_TTL_MS
    ? { kind: "pending-resend", user: row }
    : { kind: "pending-expired", user: row };
}
```

Il branch principale di `registerUser` ora è:

```ts
const decision = decideExisting(existing, Date.now());

switch (decision.kind) {
  case "verified-conflict":
    throw new ServiceError(409, "Email già registrata"); // code EMAIL_ALREADY_REGISTERED

  case "pending-resend": {
    // best-effort: invia nuovo link, ma anche se fallisce ritorna 409 PENDING al client
    let resentAt = new Date().toISOString();
    try {
      await auth.api.sendVerificationEmail({
        body: { email, callbackURL: callbackURLForRole(role) },
      });
    } catch (err) {
      log.error("sendVerificationEmail failed on pending re-signup", { err, email });
    }
    throw new ServiceError(409, "Email già in attesa di verifica. Ti abbiamo rispedito il link.", {
      code: "EMAIL_PENDING_VERIFICATION",
      resentAt,
    });
  }

  case "pending-expired": {
    await db.transaction(async (tx) => {
      await tx.delete(user).where(eq(user.id, decision.user.id));
      // tutto il resto (seller_profile / customer_profile / verification / session / account) cade
      // via FK ON DELETE CASCADE — verificare in plan execution
    });
    // FALL-THROUGH al ramo "none": signup normale
    break;
  }

  case "none":
    break;
}

// signup normale (codice esistente: auth.api.signUpEmail, set role, create profile, sendVerificationEmail)
```

**Nota su `ServiceError`**: la firma attuale (`apps/api/src/lib/errors.ts:18-29`) è `ServiceError(status, message)` con 2 argomenti, e `ERROR_CODES` (lines 2-13) è una mappa **statica 1:1** (es. `409: "CONFLICT"`) che deriva il code dallo status. Il global error handler (`apps/api/src/plugins/error-handler.ts:31-45`) ritorna `{ code, message }` e **non serializza** campi extra dell'errore.

Decisione: usare la sottoclasse `PendingVerificationError extends ServiceError` ma con **due tweak obbligatori**:

1. **Restructure di `ERROR_CODES`** da `Record<number, string>` 1:1 a `Record<number, readonly string[]>` (multi-valore per status), perché lo stesso 409 deve ora veicolare due code distinti (`EMAIL_ALREADY_REGISTERED` + `EMAIL_PENDING_VERIFICATION`) — oltre ai codici già esistenti per altre 409 (es. `CONFLICT` su `/accept-invite` e `/invite-collaborator`). In alternativa più conservativa, mantenere `ERROR_CODES` 1:1 (un code "default" per status) e permettere agli errori di **overridare** il code via campo pubblico `code` sull'istanza — questa è la via di minore impatto.
2. **Tweak del global error handler**: accettare `error.code` se l'errore lo definisce, altrimenti fallback a `ERROR_CODES[status]`. Inoltre, se l'errore espone campi extra serializzabili (es. `resentAt`), unirli nel body della response.

Forma proposta:
```ts
// apps/api/src/lib/errors.ts
export class PendingVerificationError extends ServiceError {
  public readonly code = "EMAIL_PENDING_VERIFICATION" as const;
  constructor(public readonly resentAt: string) {
    super(409, "Email già in attesa di verifica. Ti abbiamo rispedito il link.");
  }
}

// apps/api/src/plugins/error-handler.ts
if (error instanceof ServiceError) {
  const code = (error as any).code ?? ERROR_CODES[error.status];
  const extra = error instanceof PendingVerificationError ? { resentAt: error.resentAt } : {};
  return status(error.status, { code, message: error.message, ...extra });
}
```
Per `EMAIL_ALREADY_REGISTERED`, lo stesso pattern: una classe `EmailAlreadyRegisteredError extends ServiceError` con `code = "EMAIL_ALREADY_REGISTERED"` per non riusare il code generico `CONFLICT` ereditato dalla mappa default. (In alternativa, rimappare `ERROR_CODES[409]` da `"CONFLICT"` a `"EMAIL_ALREADY_REGISTERED"` rompe altri endpoint che oggi tornano 409 con semantica generica — quindi meglio sottoclassi dedicate.)

### Nuovo error code in `apps/api/src/lib/errors.ts`

Vedi sopra: la strategia consigliata è aggiungere due sottoclassi (`PendingVerificationError`, `EmailAlreadyRegisteredError`) ciascuna con `code` pubblico, e tweakare l'error handler per leggere `code` dall'istanza (con fallback a `ERROR_CODES[status]` per il resto del codebase che oggi usa `new ServiceError(...)` plain).

Questo evita di toccare `ERROR_CODES[409] = "CONFLICT"` (riusato da `/accept-invite` e `/invite-collaborator`) e mantiene retro-compatibilità totale degli altri endpoint.

### Helper `callbackURLForRole`

```ts
function callbackURLForRole(role: "seller" | "customer"): string {
  return role === "seller"
    ? `${env.SELLER_APP_URL}/login`
    : `${env.CUSTOMER_APP_URL}/login`;
}
```
Stesso valore già usato dal signup normale (oggi inline in `services.ts:52-54`): estrarre in helper riusabile.

### OpenAPI

`apps/api/src/lib/schemas/responses.ts:96-139` ospita oggi due helper:
- `withErrors(success)` aggiunge 400/401/403/404/422/500.
- `withConflictErrors(success)` aggiunge anche 409 con **un solo** `ConflictError` schema (campi `code`, `message`).

Usato in `apps/api/src/modules/registration/index.ts:107` e `apps/api/src/modules/seller/routes/employees.ts:84`. Nessun precedente di **due 409 distinti** sulla stessa route.

Opzioni:
1. **Estendere `ConflictError` schema** per includere `resentAt?: string` opzionale. La discriminazione tra i due 409 avviene via `code` letterale (`EMAIL_ALREADY_REGISTERED` | `EMAIL_PENDING_VERIFICATION`) — coerente con il resto di bibs (FE discrimina via status+code, memoria [[feedback_service_error_two_args]]).
2. **Creare un secondo helper `withTwoConflictErrors`** che dichiari due response 409 separate. Meno chirurgico, e in OpenAPI 3.0 non è banale avere due response con lo stesso status (richiede `oneOf` su content).

Decisione: opzione (1). Estendere `ConflictError` TypeBox schema in `responses.ts` con `code: Type.Union([Literal('CONFLICT'), Literal('EMAIL_ALREADY_REGISTERED'), Literal('EMAIL_PENDING_VERIFICATION'), …])` e `resentAt: Type.Optional(Type.String({ format: 'date-time' }))`. La descrizione OpenAPI italiana sulla route enumera entrambi i casi.

### Test (`apps/api/tests/registration/pending-email.test.ts`, nuovo file)

| Caso | Setup | Assert |
|---|---|---|
| Resend entro 7gg | signup seller/X, poi re-signup seller/X | 409 `EMAIL_PENDING_VERIFICATION`, body ha `resentAt`, spy `sendVerificationEmail` chiamato 2 volte totali, password non cambiata |
| Verified conflict | signup seller/X, set `emailVerified=true` in DB, re-signup | 409 `EMAIL_ALREADY_REGISTERED`, `sendVerificationEmail` chiamato 1 volta sola |
| TTL expired | signup seller/X, mutate `createdAt = now()-8d`, re-signup nuova password | 200/201 success, vecchio user.id non esiste più, nuovo user.id ha password nuova |
| Boundary inclusivo | mutate `createdAt = now()-7d+1m` | 409 `EMAIL_PENDING_VERIFICATION` |
| Cascade integrity | signup seller/X (crea seller_profile), mutate `createdAt > 7gg`, re-signup | vecchio `seller_profile.user_id` non esiste più |
| Cross-role customer | stesso pattern Resend con `/register/customer` | comportamento gemello |
| Mail send fallisce | mock `auth.api.sendVerificationEmail` throw, re-signup pending | 409 `EMAIL_PENDING_VERIFICATION` con `resentAt` corrente (non-throw), log error registrato |

---

## Architettura — Frontend (apps/seller + apps/customer)

### Componente presentational in `packages/ui`

**File**: `packages/ui/src/components/pending-verification-banner.tsx` (path **flat** — il package `exports` in `packages/ui/package.json:45-51` espone `"./components/*": "./src/components/*.tsx"` con wildcard a un solo livello; nessun barrel root)

```tsx
export type PendingVerificationBannerLabels = {
  title: string;
  body: (email: string) => string;
  resendCta: string;
  resendCooldown: (secondsRemaining: number) => string;
  forgotPassword: string;
  useOtherEmail: string;
};

export type PendingVerificationBannerProps = {
  email: string;
  secondsRemaining: number; // 0 = pulsante abilitato
  onResend: () => void | Promise<void>;
  onForgotPassword?: () => void;
  onUseOtherEmail?: () => void;
  labels: PendingVerificationBannerLabels;
  resending?: boolean; // mostra spinner durante l'await del resend
};
```

Composto da `Alert` (variant info/warning del kit shadcn esistente in `@bibs/ui`) + `Button` primario + due link secondari. Nessuna `useState` interna: tutto è driven from props (il cooldown countdown è calcolato dal connector via hook). Niente import da Paraglide, `@better-auth/*`, `@tanstack/*`.

**Export**: zero lavoro di barrel — l'export per-file via wildcard di `package.json` è già sufficiente. Il consumer importa con `import { PendingVerificationBanner } from "@bibs/ui/components/pending-verification-banner"`.

### Hook in `packages/ui`

**File**: `packages/ui/src/hooks/use-cooldown.ts`

```ts
export function useCooldown(startedAt: number | null, durationMs: number): {
  remaining: number; // ms
  secondsRemaining: number;
  ready: boolean;
} {
  // setInterval(1000) finché now-startedAt >= durationMs
  // ritorna ready=true se startedAt è null
  // cleanup su unmount o cambio di startedAt
}
```

### Connector seller — `apps/seller/src/components/auth/pending-verification-banner-connected.tsx`

Import header del connector (paths reali confermati dal codebase):
```ts
import { PendingVerificationBanner } from "@bibs/ui/components/pending-verification-banner";
import { useCooldown } from "@bibs/ui/hooks/use-cooldown";
import { Button } from "@bibs/ui/components/button"; // se serve
import { m } from "@/paraglide/messages";
import { authClient } from "@/lib/auth-client";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner"; // o helper esistente in bibs
```

```tsx
type Props = {
  email: string;
  resentAt: number; // epoch ms
  onUseOtherEmail: () => void;
};

export function PendingVerificationBannerConnected({ email, resentAt, onUseOtherEmail }: Props) {
  const navigate = useNavigate();
  const [cooldownStartedAt, setCooldownStartedAt] = useState(resentAt);
  const { secondsRemaining, ready } = useCooldown(cooldownStartedAt, 60_000);
  const [resending, setResending] = useState(false);

  const onResend = async () => {
    if (!ready || resending) return;
    setResending(true);
    try {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: `${import.meta.env.VITE_SELLER_APP_URL ?? window.location.origin}/login`,
      });
      setCooldownStartedAt(Date.now());
      toast.success(m.auth_register_pending_resent_toast());
    } catch {
      toast.error(m.auth_generic_error());
    } finally {
      setResending(false);
    }
  };

  return (
    <PendingVerificationBanner
      email={email}
      secondsRemaining={ready ? 0 : secondsRemaining}
      onResend={onResend}
      onForgotPassword={() => navigate({ to: "/forgot-password", search: { email } })}
      onUseOtherEmail={onUseOtherEmail}
      resending={resending}
      labels={{
        title: m.auth_register_pending_title(),
        body: (e) => m.auth_register_pending_body({ email: e }),
        resendCta: m.auth_register_pending_resend_cta(),
        resendCooldown: (n) => m.auth_register_pending_resend_cooldown({ seconds: String(n) }),
        forgotPassword: m.auth_register_pending_forgot_password(),
        useOtherEmail: m.auth_register_pending_use_other_email(),
      }}
    />
  );
}
```

(Il customer ha un wrapper gemello, identico salvo `CUSTOMER_APP_URL` e namespace Paraglide.)

### Cambi a `apps/seller/src/routes/register.tsx`

Stato locale extra:
```ts
const [pending, setPending] = useState<{ email: string; resentAt: number } | null>(null);
```

Nel `onSubmit`, dopo aver chiamato l'endpoint `/register/seller`:
- Se response ok → redirect a `/verify-email?email=…` (comportamento attuale, **invariato**).
- Se response error con `code === "EMAIL_PENDING_VERIFICATION"`:
  - `setPending({ email, resentAt: Date.parse(error.resentAt) })`
  - Il form resta visibile, ma sotto compare `<PendingVerificationBannerConnected email=… resentAt=… onUseOtherEmail={() => setPending(null)} />`.
- Se response error con `code === "EMAIL_ALREADY_REGISTERED"` → comportamento attuale (toast + link login).
- Altri errori → comportamento attuale invariato.

Discriminazione lato client: leggere `error.code` (string) — coerente con il pattern bibs.

### Cambi a `apps/seller/src/routes/verify-email.tsx` (e gemello customer)

Il bottone "Reinvia email di verifica" esistente (line 33 oggi è silent fail) passa a:
- Usare `useCooldown(lastSentAt, 60_000)`. `lastSentAt` inizializzato a `Date.now()` al mount della route (perché ci si arriva subito dopo signup, quindi il primo invio è appena successo).
- Mostrare cooldown countdown sul pulsante.
- Mostrare toast success/error invece del silent fail attuale.

### i18n (Paraglide)

Bibs supporta oggi **`it`** e **`en`** in entrambe le app (file `apps/{seller,customer}/messages/{it,en}.json`). Nessuna chiave `auth_*` esiste ancora — vanno tutte create. Aggiungere a `apps/seller/messages/it.json` (+ `en.json` con traduzione inglese, + replica gemella in `apps/customer/messages/{it,en}.json`):

```jsonc
{
  "auth_register_pending_title": "Conferma la tua email",
  "auth_register_pending_body": "Ti abbiamo rispedito un link a {email}. Aprilo per completare la registrazione.",
  "auth_register_pending_resend_cta": "Re-invia il link",
  "auth_register_pending_resend_cooldown": "Re-invia tra {seconds}s",
  "auth_register_pending_forgot_password": "Hai dimenticato la password?",
  "auth_register_pending_use_other_email": "Usa un'altra email",
  "auth_register_pending_resent_toast": "Email di verifica rispedita",
  "auth_generic_error": "Qualcosa è andato storto. Riprova."
}
```

Le chiavi sono replicate in `apps/customer/messages/{it,en}.json`. (Confermato: oggi `auth_generic_error` non esiste in nessuno dei quattro file — non c'è chiave da riusare. Import nei componenti via `import { m } from "@/paraglide/messages"`, come da `apps/seller/src/features/products/components/product-status-tabs.tsx:4`.)

### Componenti `@bibs/ui` riusati

Pattern di import per-file (confermato da `apps/seller/src/routes/verify-email.tsx:1-7`):
```ts
import { Alert, AlertTitle, AlertDescription } from "@bibs/ui/components/alert";
import { Button } from "@bibs/ui/components/button";
```

- `Alert` + `AlertTitle` + `AlertDescription` per il banner (variant `info` o `warning` — la più adatta dipende dal kit esistente)
- `Button` per "Re-invia"
- Component `Link`/`Button variant="link"` per i due link secondari

Nessuna nuova primitive shadcn da scaricare. (Verifica in plan execution che `Alert` esista già in `packages/ui/src/components/alert.tsx`; se manca, installare via shadcn CLI nel pkg.)

---

## Comportamento UX (riassunto flusso utente)

### Caso 1 — Re-signup entro 7gg (link smarrito)

1. Utente apre `/register` (seller o customer), inserisce email già registrata pending + password (anche diversa dalla prima volta).
2. Submit → spinner.
3. Backend rileva pending entro 7gg, re-invia il link in modo trasparente, ritorna 409 `EMAIL_PENDING_VERIFICATION` con `resentAt`.
4. Form resta visibile, sotto appare il banner:
   - Titolo "Conferma la tua email"
   - Body "Ti abbiamo rispedito un link a `email@example.com`. Aprilo per completare la registrazione."
   - Bottone "Re-invia il link" disabilitato per 60s con countdown ("Re-invia tra 45s")
   - Link "Hai dimenticato la password?"
   - Link "Usa un'altra email"
5. Utente apre l'inbox, clicca il link, viene verificato e atterra su `/login`. Login con la password che aveva inserito **la prima volta**.

### Caso 2 — Re-signup oltre 7gg (account abbandonato)

1. Utente apre `/register`, inserisce email + nuova password.
2. Submit → backend trova record pending > 7gg, lo cancella in cascade, prosegue come signup nuovo.
3. Risposta success, redirect a `/verify-email?email=…`. Nuovo link inviato con la **nuova** password.

### Caso 3 — Email davvero già registrata (verificata)

1. Submit → 409 `EMAIL_ALREADY_REGISTERED`.
2. Comportamento attuale invariato: toast/messaggio "Email già registrata", suggerimento di andare al login.

### Caso 4 — Password dimenticata sul banner (edge case)

1. Utente è sul banner di re-invio, ma realizza di non ricordare la password originale.
2. Clicca "Hai dimenticato la password?" → naviga a `/forgot-password?email=…` con email precompilata.
3. Flow esistente (da verificare in plan execution se è già implementato nel repo o se serve aggiungerlo — fuori scope di questa spec).

---

## Edge cases & sicurezza

### Race conditions

- **Vecchio link cliccato dopo re-invio**: la tabella `verification` di Better Auth può contenere più token validi simultaneamente. Cliccare uno qualunque dei due verifica lo stesso `user.id` con esito identico. Verificare in plan execution se Better Auth invalida i vecchi token al nuovo `sendVerificationEmail`: se sì, l'utente vede "token scaduto" cliccando il vecchio link — accettabile (il nuovo link è quello fresco), ma da documentare nei test.
- **Re-signup parallelo (due tab)**: una vince, l'altra prende `EMAIL_PENDING_VERIFICATION`. Comportamento corretto.
- **Cleanup TTL race**: utente fa signup, esattamente al `createdAt + 7d` un secondo signup arriva. Decidere con `<` (esclusivo) o `<=` (inclusivo). Scelta consigliata: `<` (esclusivo), quindi a 7gg+0s siamo ancora in "resend window". A 7gg+1s siamo in "expired, cleanup".

### Sicurezza — invarianti

- **Mai update di record `user` esistenti**: solo branch "ritorna errore" o "delete cascade + insert nuovo". Nessuno può cambiare password / role / metadati di un account senza controllare l'inbox.
- **Niente leak di delivery email**: errori interni di `sendVerificationEmail` sono loggati, mai esposti al client.
- **Enumeration trade-off accettato**: `EMAIL_PENDING_VERIFICATION` rivela che la mail era stata usata. Stesso livello di leak del login attuale ("password sbagliata" vs "utente non esiste"). Hardening anti-enumeration è una PR separata su tutto bibs.
- **Timing**: il branch "cleanup + signup" è leggermente più lento di "signup fresh". In teoria osservabile. Mitigation: nessuna, accettato (bibs non è target di timing attacks raffinati a questo stadio).

### Rate limiting

- **`/api/auth/send-verification-email`**: default Better Auth (10 req / 10s per IP) — già attivo, sufficiente per fermare script abusivi.
- **`POST /register/*`**: nessun rate limit dedicato. Out of scope (PR di hardening separata).

### Cascade FK

Stato verificato sui drizzle schema:

| FK | File:line | onDelete cascade? |
|---|---|---|
| `session.user_id → user.id` | `apps/api/src/db/schemas/auth.ts:36-38` | ✅ sì |
| `account.user_id → user.id` | `apps/api/src/db/schemas/auth.ts:50-52` | ✅ sì |
| `verification.user_id → user.id` | `apps/api/src/db/schemas/auth.ts:68-82` | ❌ **manca** |
| `seller_profile.user_id → user.id` | `apps/api/src/db/schemas/seller.ts:37-40` | ✅ sì |
| `customer_profile.user_id → user.id` | `apps/api/src/db/schemas/customer.ts:12-15` | ✅ sì |

**Azione obbligatoria**: aggiungere `.onDelete("cascade")` a `verification.userId` in `apps/api/src/db/schemas/auth.ts`, poi `bun run db:generate` e revisione della migration SQL prima di `bun run db:migrate`. Senza questa migration, il `DELETE FROM user` nel branch "pending-expired" fallisce con FK constraint violation se esistono record `verification` referenzianti quel `user.id`.

Bibs è ancora in dev (memoria [[project_dev_stage_no_prod]]) → schema change libero, niente backfill.

---

## Verification before completion

Prima di chiudere il task:

- [ ] `bun run typecheck` — verifica tipi Eden Treaty across api/seller/customer
- [ ] `bun run lint` — Biome
- [ ] `bun run test --filter apps/api` — i 7 casi nuovi in `pending-email.test.ts` passano
- [ ] OpenAPI a `http://localhost:3000/openapi`: `EMAIL_PENDING_VERIFICATION` appare nei response schema di `/register/seller` e `/register/customer`
- [ ] Manuale su `bun run dev:seller` (porta 3002):
  - signup con email nuova → ok (regression test, no rotture)
  - re-signup stessa email entro 7gg → banner appare, button disabled con countdown
  - aspetta 60s → button enabled
  - click "Re-invia" → toast "Inviato", countdown riparte
  - click "Hai dimenticato la password?" → naviga a `/forgot-password?email=…`
  - click "Usa un'altra email" → banner sparisce, form riusabile
- [ ] Manuale su `bun run dev:customer` (porta 3001): stessi step
- [ ] Manuale su `/verify-email`: cooldown 60s applicato anche lì, toast su success/error invece di silent fail
- [ ] Type-check su `packages/ui`: il nuovo barrel esporta `PendingVerificationBanner` e `useCooldown`

---

## Open questions per la plan execution

La maggior parte delle aperture è stata chiusa nel self-review. Resta solo:

1. **Better Auth `sendVerificationEmail` e token invalidation**: verificare in `node_modules/better-auth@1.6.11` (o nei docs ufficiali via MCP `better-auth`) se `auth.api.sendVerificationEmail()` invalida i token `verification` esistenti per quell'utente prima di emettere un nuovo token. Influenza la asserzione del test "vecchio link cliccato dopo re-invio": se i vecchi token sono invalidati, l'utente vede "token scaduto"; se no, qualsiasi link valido in tabella `verification` funziona. Entrambi i comportamenti sono accettabili per l'UX (basta documentare nei test). Risolvibile in 5 minuti di lettura source.

### Decisioni chiuse durante self-review (non più aperte)

- ✅ **`ServiceError`**: sottoclassi dedicate `PendingVerificationError` + `EmailAlreadyRegisteredError` con `code` pubblico, tweak del global error handler in `apps/api/src/plugins/error-handler.ts:31-45` per leggere `code` dall'istanza e includere `resentAt` quando presente.
- ✅ **Cascade FK**: 4/5 ok, `verification.user_id` necessita migration drizzle (vedi sezione Cascade FK sopra).
- ✅ **`/forgot-password`**: route NON esistente in seller né customer. Il link "Hai dimenticato la password?" punta a `/forgot-password?email=…` come placeholder — l'utente che clicca atterra su una route 404 finché la feature non viene implementata. Out of scope per questa PR. (Plan execution può decidere di rendere il link "ghost" — visibilità condizionata da feature flag — se vogliamo nasconderlo fino a quando `/forgot-password` esiste.)
- ✅ **Setup test `packages/ui`**: zero test runner. Nessun unit test per il presentational banner. Validazione via typecheck + manuale.
- ✅ **i18n keys**: nessuna chiave `auth_*` esiste oggi in `messages/{it,en}.json` di entrambe le app. Tutte le chiavi vanno create da zero.
- ✅ **Paraglide import**: `import { m } from "@/paraglide/messages"` (path generato, alias `@/` → `apps/{seller,customer}/src/`).
- ✅ **`@bibs/ui` import**: per-file, niente barrel (`@bibs/ui/components/<name>`).
- ✅ **Better Auth version**: 1.6.11 (root `package.json:7`).
