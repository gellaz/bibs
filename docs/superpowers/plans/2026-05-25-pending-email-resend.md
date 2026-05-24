# Pending Email Resend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sbloccare il signup di un utente che ha smarrito il link di verifica, ritornando un error code distinto (`EMAIL_PENDING_VERIFICATION`) che innesca un re-invio automatico del link e mostra un banner inline col cooldown di 60s sul form di registrazione (seller + customer).

**Architecture:** Backend `registerUser` rinasce con switch a 4 rami (`none` / `verified-conflict` / `pending-resend` / `pending-expired`). Errori specializzati via sottoclassi `ServiceError`; il global error handler legge `code` dall'istanza e serializza campi extra (`resentAt`). Frontend: nuovo componente presentational + hook in `@bibs/ui`, e un connector i18n+authClient per app che il form di registrazione monta quando il backend ritorna `EMAIL_PENDING_VERIFICATION`.

**Tech Stack:** Bun, Elysia, Drizzle ORM, Better Auth 1.6.11, TypeBox (Elysia `t`), TanStack Start/Router, Paraglide, shadcn/ui via `@bibs/ui`, sonner (toast).

**Spec di riferimento**: `docs/superpowers/specs/2026-05-24-pending-email-resend-design.md`.

---

## Nota di scoperta — `verification` table non ha FK su user

Lo spec menzionava una migration drizzle per aggiungere `.onDelete("cascade")` a `verification.userId`. **Falso**: la tabella `verification` in `apps/api/src/db/schemas/auth.ts:68-82` ha solo `id`, `identifier` (text — l'email per l'email verification), `value` (token), `expiresAt`, `createdAt`, `updatedAt`. Nessuna FK su `user`. I record verification rimangono orfani dopo DELETE user ma sono comunque time-expired e innocui. **Migration NON necessaria.** Saltiamo quella task.

---

## File Map

### Creati

| Path | Responsabilità |
|---|---|
| `apps/api/tests/modules/registration-pending-email.test.ts` | Tests service-level per i 4 rami di `registerUser` con mocks di `@/db` e `@/lib/auth` |
| `packages/ui/src/components/pending-verification-banner.tsx` | Componente presentational (Alert + Button + 2 link); zero dipendenze i18n/auth |
| `packages/ui/src/hooks/use-cooldown.ts` | Hook che ritorna `{ remaining, secondsRemaining, ready }` dato un `startedAt` epoch ms e una `durationMs` |
| `apps/seller/src/features/auth/components/pending-verification-banner-connected.tsx` | Connector seller: wrappa banner + authClient + Paraglide |
| `apps/customer/src/features/auth/components/pending-verification-banner-connected.tsx` | Connector customer: stessa cosa col namespace customer |

### Modificati

| Path | Cosa cambia |
|---|---|
| `apps/api/src/lib/errors.ts` | Aggiunte sottoclassi `EmailAlreadyRegisteredError`, `PendingVerificationError` |
| `apps/api/src/plugins/error-handler.ts` | Legge `code` dall'istanza (fallback a `ERROR_CODES[status]`); merge `resentAt` quando presente |
| `apps/api/src/lib/schemas/responses.ts` | `ConflictError` estesa: `error` diventa Union literal, +`resentAt` opzionale |
| `apps/api/src/modules/registration/services.ts` | `registerUser` riscritto: helper `decideExisting`, helper `callbackURLForRole`, switch su 4 rami |
| `apps/api/src/modules/registration/index.ts` | Aggiunto `withConflictErrors` su `/customer` e `/seller`; description italiana aggiornata |
| `apps/seller/src/routes/register.tsx` | Discrimina `error === "EMAIL_PENDING_VERIFICATION"`; monta banner |
| `apps/customer/src/routes/register.tsx` | Stessa logica seller |
| `apps/seller/src/routes/verify-email.tsx` | Cooldown 60s + toast feedback (oggi silent fail) |
| `apps/customer/src/routes/verify-email.tsx` | Stessa logica seller |
| `apps/seller/messages/{it,en}.json` | Nuove chiavi `auth_register_pending_*` + `auth_generic_error` |
| `apps/customer/messages/{it,en}.json` | Stesse chiavi |

---

### Task 1: Setup — creare feature branch

**Files:** nessuno modificato in questa task.

- [ ] **Step 1: Verificare stato pulito di main**

Run: `git status` 

Expected: `nothing to commit, working tree clean` (branch attuale: `main`).

Se ci sono modifiche pendenti, fermarsi e chiedere all'utente come procedere (potrebbero essere file dello spec già committati o no — controllare). Lo spec doc `docs/superpowers/specs/2026-05-24-pending-email-resend-design.md` esiste ma non è committato — il piano stesso verrà committato in questa task.

- [ ] **Step 2: Creare feature branch**

Run:
```bash
git checkout -b feat/auth-pending-email-resend
```

Expected: `Switched to a new branch 'feat/auth-pending-email-resend'`.

- [ ] **Step 3: Commit dello spec e del piano**

Run:
```bash
git add docs/superpowers/specs/2026-05-24-pending-email-resend-design.md docs/superpowers/plans/2026-05-25-pending-email-resend.md
git commit -m "$(cat <<'EOF'
docs(auth): spec + plan per resend link di verifica su signup pending

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit creato con 2 file (spec + plan).

---

### Task 2: Backend — sottoclassi `ServiceError` per i due 409 distinti

**Files:**
- Modify: `apps/api/src/lib/errors.ts`

- [ ] **Step 1: Aggiungere le sottoclassi in `apps/api/src/lib/errors.ts`**

Apri il file e aggiungilo (in coda dopo la classe `ServiceError` esistente):

```ts
/**
 * Errori 409 specializzati per la registrazione. Sopravvivono al global error
 * handler (apps/api/src/plugins/error-handler.ts) che legge `code` dall'istanza
 * se presente, altrimenti fa fallback a ERROR_CODES[status].
 */
export class EmailAlreadyRegisteredError extends ServiceError {
	public readonly code = "EMAIL_ALREADY_REGISTERED" as const;
	constructor(message = "Email già registrata") {
		super(409, message);
		this.name = "EmailAlreadyRegisteredError";
	}
}

export class PendingVerificationError extends ServiceError {
	public readonly code = "EMAIL_PENDING_VERIFICATION" as const;
	constructor(
		public readonly resentAt: string,
		message = "Email già in attesa di verifica. Ti abbiamo rispedito il link.",
	) {
		super(409, message);
		this.name = "PendingVerificationError";
	}
}
```

Nota: la classe base ha `public readonly code: ErrorCode` settato nel costruttore da `ERROR_CODES[status]`. Le sottoclassi dichiarano un `code` field con tipo letterale più stretto — TypeScript permette questo override perché il tipo letterale è assegnabile a `ErrorCode` (entrambi sono stringhe della mappa). Se il typechecker si lamenta, aggiungere `// @ts-expect-error narrow override` sopra ogni `code` field (test in fase di typecheck).

- [ ] **Step 2: Aggiungere le code letterali al type `ErrorCode`**

Per coerenza tipologica, estendere `ERROR_CODES` con i nuovi code per il 409. Modifica `ERROR_CODES` da:

```ts
export const ERROR_CODES = {
	// 4xx Client Errors
	400: "BAD_REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	409: "CONFLICT",
	422: "VALIDATION_ERROR",
	// 5xx Server Errors
	500: "INTERNAL_ERROR",
	503: "SERVICE_UNAVAILABLE",
} as const;
```

a:

```ts
// Default code per status — usato dal global error handler quando l'errore
// non sovrascrive `code` (per istanze plain di ServiceError).
export const ERROR_CODES = {
	// 4xx Client Errors
	400: "BAD_REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	409: "CONFLICT",
	422: "VALIDATION_ERROR",
	// 5xx Server Errors
	500: "INTERNAL_ERROR",
	503: "SERVICE_UNAVAILABLE",
} as const;

// Codici extra per status 409 — emessi dalle sottoclassi dedicate
// (EmailAlreadyRegisteredError, PendingVerificationError) e dichiarati
// nello schema ConflictError di apps/api/src/lib/schemas/responses.ts.
export const EXTRA_ERROR_CODES = ["EMAIL_ALREADY_REGISTERED", "EMAIL_PENDING_VERIFICATION"] as const;

export type ErrorStatus = keyof typeof ERROR_CODES;
export type ErrorCode =
	| (typeof ERROR_CODES)[ErrorStatus]
	| (typeof EXTRA_ERROR_CODES)[number];
```

Verifica che il rest di `errors.ts` (la classe `ServiceError` esistente) resti invariato a parte questo type widening.

- [ ] **Step 3: Typecheck per verificare**

Run: `bun run typecheck` dalla root del repo.

Expected: 0 errori. Se ci sono errori in altri file che assertano `error.code === "CONFLICT"` letteralmente, vanno gestiti caso per caso (improbabile — il pattern bibs è discriminare via `error` nel body della response, non via `instanceof`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/errors.ts
git commit -m "$(cat <<'EOF'
feat(api): aggiungi PendingVerificationError + EmailAlreadyRegisteredError

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Backend — tweak del global error handler

**Files:**
- Modify: `apps/api/src/plugins/error-handler.ts`

- [ ] **Step 1: Aggiornare il branch `ServiceError` nel handler**

Apri `apps/api/src/plugins/error-handler.ts`. Sostituisci il blocco corrente (lines 31-45):

```ts
if (error instanceof ServiceError) {
	const logLevel = error.status >= 500 ? "error" : "warn";
	pino[logLevel](
		{
			errorCode: error.code,
			errorMessage: error.message,
			statusCode: error.status,
			path: pathname,
			method,
		},
		`ServiceError: ${error.message}`,
	);

	return status(error.status, errorBody(error.code, error.message));
}
```

con:

```ts
if (error instanceof ServiceError) {
	const logLevel = error.status >= 500 ? "error" : "warn";
	pino[logLevel](
		{
			errorCode: error.code,
			errorMessage: error.message,
			statusCode: error.status,
			path: pathname,
			method,
		},
		`ServiceError: ${error.message}`,
	);

	// Le sottoclassi (PendingVerificationError, EmailAlreadyRegisteredError)
	// possono esporre campi extra serializzabili nel body della response.
	const body = errorBody(error.code, error.message);
	if (error instanceof PendingVerificationError) {
		return status(error.status, { ...body, resentAt: error.resentAt });
	}
	return status(error.status, body);
}
```

- [ ] **Step 2: Aggiungere l'import di `PendingVerificationError`**

In testa al file, modifica l'import esistente:

```ts
import { ServiceError } from "@/lib/errors";
```

in:

```ts
import { PendingVerificationError, ServiceError } from "@/lib/errors";
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`

Expected: 0 errori. Il return type dell'`onError` Elysia accetta unioni; aggiungere un campo extra al body è OK.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/plugins/error-handler.ts
git commit -m "$(cat <<'EOF'
feat(api): error handler legge code da istanza + serializza resentAt

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Backend — estendere `ConflictError` TypeBox schema

**Files:**
- Modify: `apps/api/src/lib/schemas/responses.ts`

- [ ] **Step 1: Sostituire `ConflictError` schema**

Apri `apps/api/src/lib/schemas/responses.ts`. Sostituisci (lines 63-67):

```ts
export const ConflictError = t.Object({
	success: t.Literal(false),
	error: t.Literal("CONFLICT"),
	message: t.String({ description: "Messaggio di errore leggibile" }),
});
```

con:

```ts
export const ConflictError = t.Object({
	success: t.Literal(false),
	error: t.Union(
		[
			t.Literal("CONFLICT"),
			t.Literal("EMAIL_ALREADY_REGISTERED"),
			t.Literal("EMAIL_PENDING_VERIFICATION"),
		],
		{ description: "Discriminator dell'errore 409 specifico" },
	),
	message: t.String({ description: "Messaggio di errore leggibile" }),
	// Presente solo quando error === "EMAIL_PENDING_VERIFICATION".
	resentAt: t.Optional(
		t.String({
			format: "date-time",
			description:
				"ISO timestamp dell'invio del link di verifica appena rispedito",
		}),
	),
});
```

`ErrorResponse` (line 82-93) deriva da `ConflictError` via `t.Union([...])` — non serve modificarlo, lo Union si propaga.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`

Expected: 0 errori. Il `error: t.Union([...])` è retro-compatibile (`"CONFLICT"` resta valido).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/schemas/responses.ts
git commit -m "$(cat <<'EOF'
feat(api): ConflictError schema accetta i nuovi 409 code + resentAt

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Backend — helper `callbackURLForRole` + `decideExisting`

**Files:**
- Modify: `apps/api/src/modules/registration/services.ts`

- [ ] **Step 1: Aggiungere import + costanti**

Apri `apps/api/src/modules/registration/services.ts`. Aggiungi alle import esistenti (in cima):

```ts
import {
	EmailAlreadyRegisteredError,
	PendingVerificationError,
	ServiceError,
} from "@/lib/errors";
import { getLogger } from "@/lib/logger";
```

(Il import `ServiceError` esiste già da `@/lib/errors`; sostituiscilo con la riga sopra. L'import di `getLogger` è nuovo perché serve per loggare il mail-send failure nel ramo pending-resend.)

Poi, sotto gli import e prima del codice esistente, aggiungi:

```ts
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

type UserRow = NonNullable<Awaited<ReturnType<typeof db.query.user.findFirst>>>;

type ExistingDecision =
	| { kind: "none" }
	| { kind: "verified-conflict"; user: UserRow }
	| { kind: "pending-resend"; user: UserRow }
	| { kind: "pending-expired"; user: UserRow };

/**
 * Decide come gestire un eventuale `user` esistente con la stessa email durante
 * un signup. Niente side-effect: ritorna la decisione, il chiamante esegue.
 */
export function decideExistingUser(
	row: UserRow | undefined | null,
	now: number,
): ExistingDecision {
	if (!row) return { kind: "none" };
	if (row.emailVerified) return { kind: "verified-conflict", user: row };
	const age = now - new Date(row.createdAt).getTime();
	return age < PENDING_TTL_MS
		? { kind: "pending-resend", user: row }
		: { kind: "pending-expired", user: row };
}

function callbackURLForRole(role: "seller" | "customer"): string {
	return role === "seller"
		? `${env.SELLER_APP_URL}/login`
		: `${env.CUSTOMER_APP_URL}/login`;
}
```

`env` è già importato in cima al file. Esporto `decideExistingUser` perché i test lo testeranno in isolation senza tirare in piedi il signup completo.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`

Expected: 0 errori. `UserRow` deriva dal tipo di `db.query.user.findFirst`, che dipende dallo schema drizzle.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/registration/services.ts
git commit -m "$(cat <<'EOF'
feat(api): aggiungi helper decideExistingUser + callbackURLForRole

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Backend — riscrivere `registerUser` con switch a 4 rami

**Files:**
- Modify: `apps/api/src/modules/registration/services.ts`

- [ ] **Step 1: Sostituire il corpo di `registerUser`**

Apri `apps/api/src/modules/registration/services.ts`. La funzione attuale (lines 31-61) è:

```ts
async function registerUser<T>(params: RegisterUserParams<T>) {
	const { email, password, role, callbackURL, createProfile } = params;
	const name = email.split("@")[0];

	const existing = await db.query.user.findFirst({
		where: eq(user.email, email),
	});
	if (existing) {
		throw new ServiceError(409, "Email already registered");
	}

	const { user: newUser, token } = await auth.api.signUpEmail({
		body: { name, email, password },
	});

	const profile = await db.transaction(async (tx) => {
		await tx.update(user).set({ role }).where(eq(user.id, newUser.id));

		return createProfile(tx, newUser.id);
	});

	await auth.api.sendVerificationEmail({
		body: { email, callbackURL },
	});

	return {
		user: { ...newUser, role },
		profile,
		token,
	};
}
```

Sostituiscilo (manteniamo il parametro `callbackURL` per ora — è già passato dai chiamanti e useremo lo stesso valore):

```ts
async function registerUser<T>(params: RegisterUserParams<T>) {
	const { email, password, role, callbackURL, createProfile } = params;
	const name = email.split("@")[0];
	const log = getLogger();

	const existing = await db.query.user.findFirst({
		where: eq(user.email, email),
	});

	const decision = decideExistingUser(existing, Date.now());

	switch (decision.kind) {
		case "verified-conflict":
			throw new EmailAlreadyRegisteredError();

		case "pending-resend": {
			// Best-effort: invia un nuovo link. Anche se fallisce, ritorna 409
			// PENDING al client — il banner mostrerà comunque il bottone "Re-invia"
			// per un secondo tentativo manuale.
			const resentAt = new Date().toISOString();
			try {
				await auth.api.sendVerificationEmail({
					body: { email, callbackURL },
				});
			} catch (err) {
				log.error(
					{ err, email },
					"sendVerificationEmail failed on pending re-signup",
				);
			}
			throw new PendingVerificationError(resentAt);
		}

		case "pending-expired": {
			// Vecchio account abbandonato → DELETE CASCADE e procedi come signup nuovo.
			// session/account/sellerProfile/customerProfile cadono via FK cascade.
			// I record verification con identifier=email rimangono orfani ma sono
			// time-expired (vedi nota nel piano: la tabella verification non ha FK).
			await db.delete(user).where(eq(user.id, decision.user.id));
			break;
		}

		case "none":
			break;
	}

	const { user: newUser, token } = await auth.api.signUpEmail({
		body: { name, email, password },
	});

	const profile = await db.transaction(async (tx) => {
		await tx.update(user).set({ role }).where(eq(user.id, newUser.id));

		return createProfile(tx, newUser.id);
	});

	await auth.api.sendVerificationEmail({
		body: { email, callbackURL },
	});

	return {
		user: { ...newUser, role },
		profile,
		token,
	};
}
```

Note implementative:
- `decideExistingUser` è importato dallo stesso file (sopra in Task 5).
- `getLogger()` è importato in Task 5; ritorna un pino-compatible logger. (Se la firma di `getLogger` accetta un `store`, controllare la signature in `apps/api/src/lib/logger.ts` e adattare di conseguenza. Se richiede uno store, usare `console.error` come fallback per ora — non blocca il piano.)

- [ ] **Step 2: Verificare la signature di `getLogger`**

Run: `grep -n "export function getLogger\|export const getLogger" apps/api/src/lib/logger.ts`

Se `getLogger` richiede un `store` arg, sostituire `const log = getLogger();` con `const log = getLogger(undefined as any);` o equivalente — il logging della mail-send failure non è critico, basta che non rompa il typecheck. In alternativa, usare:

```ts
} catch (err) {
	console.error("sendVerificationEmail failed on pending re-signup", { err, email });
}
```

E rimuovere l'import `getLogger` da Task 5.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`

Expected: 0 errori.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/registration/services.ts
git commit -m "$(cat <<'EOF'
feat(api): registerUser gestisce 4 rami per email pending/expired/verified

- verified-conflict → EmailAlreadyRegisteredError
- pending-resend → re-invio + PendingVerificationError(resentAt)
- pending-expired → DELETE CASCADE + signup nuovo
- none → signup normale

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Backend — dichiarazione OpenAPI nelle route

**Files:**
- Modify: `apps/api/src/modules/registration/index.ts`

- [ ] **Step 1: Aggiungere `withConflictErrors` su `/customer`**

Apri `apps/api/src/modules/registration/index.ts`. Modifica la route `/customer` (lines 18-50). Cambia il blocco `{ body: ..., detail: ... }`:

```ts
{
	body: t.Object({
		email: t.String({ format: "email", description: "Indirizzo email" }),
		password: t.String({
			minLength: 8,
			maxLength: 128,
			description: "Password (minimo 8, massimo 128 caratteri)",
		}),
	}),
	detail: {
		summary: "Registrazione cliente",
		description:
			"Crea un nuovo account cliente con profilo e saldo punti inizializzato a zero.",
	},
},
```

in:

```ts
{
	body: t.Object({
		email: t.String({ format: "email", description: "Indirizzo email" }),
		password: t.String({
			minLength: 8,
			maxLength: 128,
			description: "Password (minimo 8, massimo 128 caratteri)",
		}),
	}),
	response: withConflictErrors({ 200: okRes(t.Any()) }),
	detail: {
		summary: "Registrazione cliente",
		description:
			"Crea un nuovo account cliente con profilo e saldo punti inizializzato a zero. Errori 409: `EMAIL_ALREADY_REGISTERED` se l'email è già verificata; `EMAIL_PENDING_VERIFICATION` se l'email esiste ma è in attesa di verifica (entro 7gg) — il backend re-invia il link automaticamente e il body contiene `resentAt`.",
	},
},
```

Aggiungi `okRes` all'import in cima al file:

```ts
import { OkMessage, okRes, withConflictErrors } from "@/lib/schemas";
```

Nota: `okRes(t.Any())` è una scappatoia per `data` di tipo arbitrario perché il `RegisterSeller`/`RegisterCustomer` return non ha uno schema TypeBox dedicato oggi. Se in plan execution emerge che `okRes` non accetta `t.Any()`, sostituire con `t.Object({ user: t.Any(), profile: t.Any(), token: t.String() })` o equivalente. È OpenAPI cosmetics, non blocca il flow.

- [ ] **Step 2: Aggiungere `withConflictErrors` su `/seller`**

Stessa modifica simmetrica sulla route `/seller` (lines 51-83). Aggiungi `response: withConflictErrors({ 200: okRes(t.Any()) }),` e aggiorna `detail.description`:

```
"Crea un nuovo account venditore. Dopo la verifica email, il venditore dovrà completare l'onboarding (dati personali, documento, azienda, negozio, pagamento). Errori 409: `EMAIL_ALREADY_REGISTERED` se l'email è già verificata; `EMAIL_PENDING_VERIFICATION` se l'email esiste ma è in attesa di verifica (entro 7gg) — il backend re-invia il link automaticamente e il body contiene `resentAt`."
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`

Expected: 0 errori. Se l'errore è del tipo "Type 'T' does not satisfy schema X", sostituire `t.Any()` con uno schema più stretto come descritto sopra.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/registration/index.ts
git commit -m "$(cat <<'EOF'
feat(api): documenta i due 409 distinti su /register/{customer,seller}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Backend — unit test per `decideExistingUser` (pure function, fast)

**Files:**
- Create: `apps/api/tests/modules/registration-pending-email.test.ts`

- [ ] **Step 1: Creare il file con il test della pure function**

Crea `apps/api/tests/modules/registration-pending-email.test.ts` con:

```ts
import { describe, expect, it } from "bun:test";
import { decideExistingUser } from "@/modules/registration/services";

const NOW = Date.parse("2026-05-25T12:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function userRow(overrides: Partial<{ createdAt: Date; emailVerified: boolean }> = {}) {
	return {
		id: "user-1",
		name: "Test",
		email: "test@example.it",
		emailVerified: false,
		image: null,
		createdAt: new Date(NOW - 1000),
		updatedAt: new Date(NOW),
		role: null,
		banned: null,
		banReason: null,
		banExpires: null,
		firstName: null,
		lastName: null,
		birthDate: null,
		...overrides,
	} as any;
}

describe("decideExistingUser", () => {
	it("returns 'none' when row is null/undefined", () => {
		expect(decideExistingUser(null, NOW).kind).toBe("none");
		expect(decideExistingUser(undefined, NOW).kind).toBe("none");
	});

	it("returns 'verified-conflict' when emailVerified=true", () => {
		const row = userRow({ emailVerified: true });
		const decision = decideExistingUser(row, NOW);
		expect(decision.kind).toBe("verified-conflict");
	});

	it("returns 'pending-resend' when emailVerified=false and createdAt within 7gg", () => {
		const row = userRow({ createdAt: new Date(NOW - SEVEN_DAYS_MS + 60_000) });
		const decision = decideExistingUser(row, NOW);
		expect(decision.kind).toBe("pending-resend");
	});

	it("boundary: returns 'pending-resend' at exactly 7gg - 1ms (window is exclusive on the upper end)", () => {
		const row = userRow({ createdAt: new Date(NOW - SEVEN_DAYS_MS + 1) });
		expect(decideExistingUser(row, NOW).kind).toBe("pending-resend");
	});

	it("boundary: returns 'pending-expired' at exactly 7gg (the window is `age < PENDING_TTL_MS`)", () => {
		const row = userRow({ createdAt: new Date(NOW - SEVEN_DAYS_MS) });
		expect(decideExistingUser(row, NOW).kind).toBe("pending-expired");
	});

	it("returns 'pending-expired' when older than 7gg", () => {
		const row = userRow({ createdAt: new Date(NOW - 10 * 24 * 60 * 60 * 1000) });
		const decision = decideExistingUser(row, NOW);
		expect(decision.kind).toBe("pending-expired");
	});
});
```

- [ ] **Step 2: Eseguire il test e verificare che passi**

Run dalla root: `bun test apps/api/tests/modules/registration-pending-email.test.ts`

Expected: 6 tests passed. Se qualcuno fallisce per "module not found", verifica che `decideExistingUser` sia esportato in `services.ts` (Task 5 Step 1).

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/modules/registration-pending-email.test.ts
git commit -m "$(cat <<'EOF'
test(api): unit test decideExistingUser (6 casi inclusi boundary)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Backend — test integration route-level per i 409 distinti

**Files:**
- Modify: `apps/api/tests/modules/registration.test.ts` (estende il file esistente, no nuovo file)

Motivazione: il test esistente `registration.test.ts` mocka `@/modules/registration/services` e testa il ROUTE handler. È il pattern giusto per verificare che il global error handler propaghi correttamente i due nuovi 409 code distinti con `resentAt` nel body. Estendiamo quel file.

- [ ] **Step 1: Aggiungere import**

In testa a `apps/api/tests/modules/registration.test.ts`, sostituisci l'import `import { ServiceError } from "@/lib/errors";` con:

```ts
import {
	EmailAlreadyRegisteredError,
	PendingVerificationError,
	ServiceError,
} from "@/lib/errors";
```

- [ ] **Step 2: Aggiungere i nuovi test cases per `/register/seller`**

Aggiungi in fondo al describe `POST /register/seller — service errors` (o crea il describe se non esiste — il file attuale non ne ha uno per seller, solo per customer; aggiungi a `describe("POST /register/seller — success")` o crea un nuovo describe). Inserisci PRIMA del describe finale `acceptInvite storeEmployeeStores propagation`:

```ts
describe("POST /register/seller — pending email scenarios", () => {
	it("returns 409 EMAIL_ALREADY_REGISTERED when service throws EmailAlreadyRegisteredError", async () => {
		mockRegisterSeller.mockImplementationOnce(async () => {
			throw new EmailAlreadyRegisteredError();
		});
		const res = await post("/register/seller", {
			email: "luca@example.it",
			password: "password123",
		});
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("EMAIL_ALREADY_REGISTERED");
		expect(body.message).toBe("Email già registrata");
	});

	it("returns 409 EMAIL_PENDING_VERIFICATION with resentAt when service throws PendingVerificationError", async () => {
		const fakeResentAt = "2026-05-25T13:00:00.000Z";
		mockRegisterSeller.mockImplementationOnce(async () => {
			throw new PendingVerificationError(fakeResentAt);
		});
		const res = await post("/register/seller", {
			email: "luca@example.it",
			password: "password123",
		});
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("EMAIL_PENDING_VERIFICATION");
		expect(body.resentAt).toBe(fakeResentAt);
	});

	it("plain ServiceError(409) still gets default code 'CONFLICT' (back-compat)", async () => {
		mockRegisterSeller.mockImplementationOnce(async () => {
			throw new ServiceError(409, "Email già registrata");
		});
		const res = await post("/register/seller", {
			email: "luca@example.it",
			password: "password123",
		});
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.error).toBe("CONFLICT");
		expect(body.resentAt).toBeUndefined();
	});
});

describe("POST /register/customer — pending email scenarios", () => {
	it("returns 409 EMAIL_PENDING_VERIFICATION with resentAt for customer flow", async () => {
		const fakeResentAt = "2026-05-25T13:30:00.000Z";
		mockRegisterCustomer.mockImplementationOnce(async () => {
			throw new PendingVerificationError(fakeResentAt);
		});
		const res = await post("/register/customer", {
			email: "mario@example.it",
			password: "password123",
		});
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.error).toBe("EMAIL_PENDING_VERIFICATION");
		expect(body.resentAt).toBe(fakeResentAt);
	});

	it("returns 409 EMAIL_ALREADY_REGISTERED for customer flow", async () => {
		mockRegisterCustomer.mockImplementationOnce(async () => {
			throw new EmailAlreadyRegisteredError();
		});
		const res = await post("/register/customer", {
			email: "mario@example.it",
			password: "password123",
		});
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.error).toBe("EMAIL_ALREADY_REGISTERED");
	});
});
```

- [ ] **Step 3: Eseguire tutti i test del file**

Run: `bun test apps/api/tests/modules/registration.test.ts`

Expected: 5 nuovi test passano. I test esistenti continuano a passare (la modifica al handler è retro-compatibile per le plain `ServiceError(409)`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/modules/registration.test.ts
git commit -m "$(cat <<'EOF'
test(api): route-level test per i due 409 distinti + resentAt propagation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: packages/ui — hook `useCooldown`

**Files:**
- Create: `packages/ui/src/hooks/use-cooldown.ts`

- [ ] **Step 1: Creare il file**

Crea `packages/ui/src/hooks/use-cooldown.ts` con:

```ts
import { useEffect, useState } from "react";

export type UseCooldownResult = {
	remaining: number; // milliseconds
	secondsRemaining: number; // ceil(remaining / 1000)
	ready: boolean;
};

/**
 * Cooldown timer driven by an `startedAt` epoch (ms) and a `durationMs`.
 *
 * - Returns `ready: true` when `startedAt` is null OR when now - startedAt >= durationMs.
 * - Re-renders every ~1s while running, until ready.
 * - Cleans up the interval on unmount or when startedAt changes.
 *
 * The hook does NOT call back when ready — the consumer reads `ready` from the
 * return value to decide whether to enable a button etc.
 */
export function useCooldown(
	startedAt: number | null,
	durationMs: number,
): UseCooldownResult {
	const compute = (): UseCooldownResult => {
		if (startedAt == null) {
			return { remaining: 0, secondsRemaining: 0, ready: true };
		}
		const elapsed = Date.now() - startedAt;
		const remaining = Math.max(0, durationMs - elapsed);
		return {
			remaining,
			secondsRemaining: Math.ceil(remaining / 1000),
			ready: remaining === 0,
		};
	};

	const [state, setState] = useState<UseCooldownResult>(compute);

	useEffect(() => {
		// Recompute immediately when inputs change.
		setState(compute());

		if (startedAt == null) return;
		const now = Date.now();
		if (now - startedAt >= durationMs) return;

		const id = setInterval(() => {
			const next = compute();
			setState(next);
			if (next.ready) clearInterval(id);
		}, 1000);

		return () => clearInterval(id);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [startedAt, durationMs]);

	return state;
}
```

- [ ] **Step 2: Typecheck del package**

Run: `bun run --cwd packages/ui typecheck`

Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/use-cooldown.ts
git commit -m "$(cat <<'EOF'
feat(ui): aggiungi hook useCooldown per countdown timer riusabile

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: packages/ui — `PendingVerificationBanner` (presentational)

**Files:**
- Create: `packages/ui/src/components/pending-verification-banner.tsx`

- [ ] **Step 1: Verificare presenza di `Alert`**

Run: `ls packages/ui/src/components/alert.tsx packages/ui/src/components/button.tsx`

Expected: entrambi esistono. (Già verificato in fase di esplorazione.)

- [ ] **Step 2: Creare il componente**

Crea `packages/ui/src/components/pending-verification-banner.tsx` con:

```tsx
import { Alert, AlertDescription, AlertTitle } from "~/components/alert";
import { Button } from "~/components/button";
import { cn } from "~/lib/utils";

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
	/** Seconds remaining before the resend button is re-enabled. 0 = enabled. */
	secondsRemaining: number;
	onResend: () => void | Promise<void>;
	onForgotPassword?: () => void;
	onUseOtherEmail?: () => void;
	labels: PendingVerificationBannerLabels;
	/** Shows spinner / disables the resend button while a resend call is in flight. */
	resending?: boolean;
	className?: string;
};

export function PendingVerificationBanner({
	email,
	secondsRemaining,
	onResend,
	onForgotPassword,
	onUseOtherEmail,
	labels,
	resending = false,
	className,
}: PendingVerificationBannerProps) {
	const cooldownActive = secondsRemaining > 0;
	const resendDisabled = cooldownActive || resending;

	return (
		<Alert
			className={cn("mt-4 flex flex-col gap-3", className)}
			data-testid="pending-verification-banner"
		>
			<AlertTitle>{labels.title}</AlertTitle>
			<AlertDescription>{labels.body(email)}</AlertDescription>
			<div className="flex flex-col gap-2 pt-1">
				<Button
					type="button"
					onClick={() => {
						if (!resendDisabled) void onResend();
					}}
					disabled={resendDisabled}
					className="w-full"
				>
					{cooldownActive
						? labels.resendCooldown(secondsRemaining)
						: labels.resendCta}
				</Button>
				<div className="flex flex-col gap-1 text-center text-sm">
					{onForgotPassword && (
						<Button
							variant="link"
							type="button"
							onClick={onForgotPassword}
							className="h-auto p-0"
						>
							{labels.forgotPassword}
						</Button>
					)}
					{onUseOtherEmail && (
						<Button
							variant="link"
							type="button"
							onClick={onUseOtherEmail}
							className="h-auto p-0"
						>
							{labels.useOtherEmail}
						</Button>
					)}
				</div>
			</div>
		</Alert>
	);
}
```

Notes:
- `~/components/alert` e `~/components/button`: dentro `packages/ui` l'alias `~/` punta a `packages/ui/src/`. Verificare in `packages/ui/tsconfig.json` se l'alias non è `~/` ma `@/` o altro — adattare i due import di conseguenza. (Confermo dall'alert.tsx letto: usa `~/lib/utils`, quindi `~/` è corretto.)
- Niente `useState`: tutto driven from props. Il connector gestisce il cooldown via `useCooldown`.

- [ ] **Step 3: Typecheck del package**

Run: `bun run --cwd packages/ui typecheck`

Expected: 0 errori.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/pending-verification-banner.tsx
git commit -m "$(cat <<'EOF'
feat(ui): aggiungi PendingVerificationBanner presentational

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: i18n — aggiungere chiavi Paraglide in tutti e 4 i file

**Files:**
- Modify: `apps/seller/messages/it.json`
- Modify: `apps/seller/messages/en.json`
- Modify: `apps/customer/messages/it.json`
- Modify: `apps/customer/messages/en.json`

- [ ] **Step 1: Aggiungere chiavi a `apps/seller/messages/it.json`**

Apri il file. Aggiungi queste chiavi in fondo all'oggetto JSON (prima della parentesi `}` di chiusura, con una virgola dopo l'ultima chiave esistente):

```json
"auth_register_pending_title": "Conferma la tua email",
"auth_register_pending_body": "Ti abbiamo rispedito un link a {email}. Aprilo per completare la registrazione.",
"auth_register_pending_resend_cta": "Re-invia il link",
"auth_register_pending_resend_cooldown": "Re-invia tra {seconds}s",
"auth_register_pending_forgot_password": "Hai dimenticato la password?",
"auth_register_pending_use_other_email": "Usa un'altra email",
"auth_register_pending_resent_toast": "Email di verifica rispedita",
"auth_verify_email_resend_cooldown": "Re-invia tra {seconds}s",
"auth_verify_email_resent_toast": "Email reinviata con successo",
"auth_verify_email_resend_error": "Impossibile reinviare l'email. Riprova tra qualche secondo.",
"auth_generic_error": "Qualcosa è andato storto. Riprova."
```

- [ ] **Step 2: Aggiungere chiavi a `apps/seller/messages/en.json`**

Stessi keys, traduzioni inglesi:

```json
"auth_register_pending_title": "Verify your email",
"auth_register_pending_body": "We just resent a link to {email}. Open it to complete the registration.",
"auth_register_pending_resend_cta": "Resend the link",
"auth_register_pending_resend_cooldown": "Resend in {seconds}s",
"auth_register_pending_forgot_password": "Forgot your password?",
"auth_register_pending_use_other_email": "Use another email",
"auth_register_pending_resent_toast": "Verification email resent",
"auth_verify_email_resend_cooldown": "Resend in {seconds}s",
"auth_verify_email_resent_toast": "Email resent successfully",
"auth_verify_email_resend_error": "Couldn't resend the email. Try again in a few seconds.",
"auth_generic_error": "Something went wrong. Please try again."
```

- [ ] **Step 3: Replicare in `apps/customer/messages/it.json` e `apps/customer/messages/en.json`**

Aggiungere le stesse chiavi (italiano e inglese rispettivamente) ai due file customer. I valori sono identici a quelli seller (lo scope d'uso è lo stesso: form di registrazione).

- [ ] **Step 4: Typecheck (Paraglide rigenera i tipi)**

Paraglide genera automaticamente `apps/{seller,customer}/src/paraglide/messages.ts` al typecheck/build se il plugin Vite è configurato. Run dalla root:

```bash
bun run typecheck
```

Expected: 0 errori. Se Paraglide non rigenera automaticamente, eseguire `bun run --cwd apps/seller build` (o l'equivalente paraglide compile command) e poi ripetere typecheck.

In alternativa, alcuni repo bibs rigenerano i tipi solo al dev/build server start. Se i tipi non si rigenerano, lanciare brevemente `bun run --cwd apps/seller dev` (Ctrl+C dopo che il server è up) per triggerare la compilazione Paraglide.

- [ ] **Step 5: Commit**

```bash
git add apps/seller/messages/*.json apps/customer/messages/*.json
git commit -m "$(cat <<'EOF'
feat(i18n): aggiungi chiavi auth_register_pending_* e auth_verify_email_*

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Frontend seller — connector + integrazione `register.tsx`

**Files:**
- Create: `apps/seller/src/features/auth/components/pending-verification-banner-connected.tsx`
- Modify: `apps/seller/src/routes/register.tsx`

- [ ] **Step 1: Creare il connector seller**

Crea `apps/seller/src/features/auth/components/pending-verification-banner-connected.tsx` con:

```tsx
import { PendingVerificationBanner } from "@bibs/ui/components/pending-verification-banner";
import { useCooldown } from "@bibs/ui/hooks/use-cooldown";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

type Props = {
	email: string;
	/** Epoch ms — momento in cui il backend ha rispedito il link. */
	resentAt: number;
	onUseOtherEmail: () => void;
};

const COOLDOWN_MS = 60_000;

export function PendingVerificationBannerConnected({
	email,
	resentAt,
	onUseOtherEmail,
}: Props) {
	const navigate = useNavigate();
	const [cooldownStartedAt, setCooldownStartedAt] = useState<number>(resentAt);
	const { secondsRemaining, ready } = useCooldown(cooldownStartedAt, COOLDOWN_MS);
	const [resending, setResending] = useState(false);

	const onResend = async () => {
		if (!ready || resending) return;
		setResending(true);
		try {
			await authClient.sendVerificationEmail({
				email,
				callbackURL: `${window.location.origin}/login`,
			});
			setCooldownStartedAt(Date.now());
			toast.success(m.auth_register_pending_resent_toast());
		} catch {
			toast.error(m.auth_generic_error());
		} finally {
			setResending(false);
		}
	};

	const onForgotPassword = () => {
		// La route /forgot-password non esiste ancora (out of scope dello spec).
		// Il link punta comunque al placeholder per quando la feature arriverà.
		void navigate({
			// biome-ignore lint/suspicious/noExplicitAny: route non ancora dichiarata
			to: "/forgot-password" as any,
			search: { email } as any,
		});
	};

	return (
		<PendingVerificationBanner
			email={email}
			secondsRemaining={ready ? 0 : secondsRemaining}
			onResend={onResend}
			onForgotPassword={onForgotPassword}
			onUseOtherEmail={onUseOtherEmail}
			resending={resending}
			labels={{
				title: m.auth_register_pending_title(),
				body: (e) => m.auth_register_pending_body({ email: e }),
				resendCta: m.auth_register_pending_resend_cta(),
				resendCooldown: (n) =>
					m.auth_register_pending_resend_cooldown({ seconds: String(n) }),
				forgotPassword: m.auth_register_pending_forgot_password(),
				useOtherEmail: m.auth_register_pending_use_other_email(),
			}}
		/>
	);
}
```

Nota su biome-ignore: TanStack Router type-checks le route. Dato che `/forgot-password` non esiste, `navigate({ to: "/forgot-password", ... })` darebbe type error. Il cast è temporaneo finché la route esiste. Quando la feature arriva, rimuovere i cast.

- [ ] **Step 2: Aggiornare `apps/seller/src/routes/register.tsx`**

Apri il file. Sostituisci tutto il contenuto del componente `RegisterPage` (lines 20-74) con:

```tsx
function RegisterPage() {
	const navigate = useNavigate();
	const [error, setError] = useState("");
	const [pending, setPending] = useState<{
		email: string;
		resentAt: number;
	} | null>(null);

	const { data: session } = authClient.useSession();

	if (session?.user) {
		void navigate({ to: "/" });
		return null;
	}

	async function handleSubmit(data: RegisterFormData) {
		setError("");
		setPending(null);

		try {
			const { error: regError } = await api().register.seller.post({
				email: data.email,
				password: data.password,
			});

			if (regError) {
				const errVal = regError.value as {
					error?: string;
					message?: string;
					resentAt?: string;
				};

				if (errVal.error === "EMAIL_PENDING_VERIFICATION" && errVal.resentAt) {
					setPending({
						email: data.email,
						resentAt: Date.parse(errVal.resentAt),
					});
					return;
				}

				setError(errVal.message ?? "Errore durante la registrazione");
				return;
			}

			void navigate({ to: "/verify-email", search: { email: data.email } });
		} catch {
			setError("Errore durante la registrazione. Riprova.");
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<BrandMark className="mx-auto mb-2 size-12" />
					<CardTitle className="text-xl">Registrati come Venditore</CardTitle>
					<CardDescription>
						Crea il tuo account per iniziare a vendere su bibs
					</CardDescription>
				</CardHeader>
				<CardContent>
					<RegisterForm onSubmit={handleSubmit} apiError={error} />
					{pending && (
						<PendingVerificationBannerConnected
							email={pending.email}
							resentAt={pending.resentAt}
							onUseOtherEmail={() => setPending(null)}
						/>
					)}
					<p className="mt-4 text-center text-sm text-muted-foreground">
						Hai già un account?{" "}
						<Link to="/login" className="text-primary underline">
							Accedi
						</Link>
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
```

E aggiungi l'import del connector in testa al file:

```ts
import { PendingVerificationBannerConnected } from "@/features/auth/components/pending-verification-banner-connected";
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`

Expected: 0 errori. Se Eden Treaty si lamenta di `errVal.resentAt`, è perché lo schema lo tipa come `Optional<string>` — `errVal.resentAt` è `string | undefined`. La check `&& errVal.resentAt` è già lì per disambiguare.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/features/auth/components/pending-verification-banner-connected.tsx apps/seller/src/routes/register.tsx
git commit -m "$(cat <<'EOF'
feat(seller): banner re-invia link su signup pending

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Frontend customer — connector + integrazione `register.tsx`

**Files:**
- Create: `apps/customer/src/features/auth/components/pending-verification-banner-connected.tsx`
- Modify: `apps/customer/src/routes/register.tsx`

- [ ] **Step 1: Creare il connector customer**

Verifica prima che la directory esista:
```bash
ls apps/customer/src/features/auth/components/ 2>&1 || mkdir -p apps/customer/src/features/auth/components/
```

Crea `apps/customer/src/features/auth/components/pending-verification-banner-connected.tsx` con contenuto **identico** al connector seller (Task 13 Step 1), perché:
- Stesso `@/lib/auth-client` (path uguale, alias `@/` punta a `apps/customer/src/`).
- Stesso `@/paraglide/messages` (i tipi sono per-app ma le chiavi hanno nomi identici).
- Stesso `window.location.origin` come callbackURL.
- Stesso comportamento UX.

Copia esatta del file Task 13 Step 1. Niente da cambiare.

- [ ] **Step 2: Aggiornare `apps/customer/src/routes/register.tsx`**

Apri il file. Sostituisci il componente `RegisterPage` (lines 46-155) — questo file ha il form inline (non usa un component RegisterForm wrapped). Inserisci lo state `pending`, gestisci l'error code, monta il banner.

Sostituisci la funzione `onSubmit` (lines 64-81) con:

```tsx
const onSubmit: SubmitHandler<RegisterFormData> = async (data) => {
	setError("");
	setPending(null);
	try {
		const { error: regError } = await api().register.customer.post({
			email: data.email,
			password: data.password,
		});

		if (regError) {
			const errVal = regError.value as {
				error?: string;
				message?: string;
				resentAt?: string;
			};

			if (errVal.error === "EMAIL_PENDING_VERIFICATION" && errVal.resentAt) {
				setPending({
					email: data.email,
					resentAt: Date.parse(errVal.resentAt),
				});
				return;
			}

			setError(errVal.message ?? "Errore durante la registrazione");
			return;
		}

		void navigate({ to: "/verify-email", search: { email: data.email } });
	} catch {
		setError("Errore durante la registrazione. Riprova.");
	}
};
```

E aggiungi lo state vicino agli altri (sotto `const [error, setError] = useState("");`, line 48):

```tsx
const [pending, setPending] = useState<{ email: string; resentAt: number } | null>(null);
```

E monta il banner sotto la chiusura del `</form>` (sopra il `<p>Hai già un account?</p>` di line 145):

```tsx
{pending && (
	<PendingVerificationBannerConnected
		email={pending.email}
		resentAt={pending.resentAt}
		onUseOtherEmail={() => setPending(null)}
	/>
)}
```

E aggiungi l'import in testa al file:

```ts
import { PendingVerificationBannerConnected } from "@/features/auth/components/pending-verification-banner-connected";
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`

Expected: 0 errori.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/features/auth/components/pending-verification-banner-connected.tsx apps/customer/src/routes/register.tsx
git commit -m "$(cat <<'EOF'
feat(customer): banner re-invia link su signup pending

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Frontend — cooldown 60s + toast su `/verify-email` (seller + customer)

**Files:**
- Modify: `apps/seller/src/routes/verify-email.tsx`
- Modify: `apps/customer/src/routes/verify-email.tsx`

- [ ] **Step 1: Aggiornare `apps/seller/src/routes/verify-email.tsx`**

Sostituisci il componente `VerifyEmailPage` (lines 24-102) con:

```tsx
function VerifyEmailPage() {
	const { email } = Route.useSearch();
	const [lastSentAt, setLastSentAt] = useState<number>(() => Date.now());
	const { secondsRemaining, ready } = useCooldown(lastSentAt, 60_000);
	const [resending, setResending] = useState(false);

	async function handleResend() {
		if (!email || !ready || resending) return;
		setResending(true);
		try {
			await authClient.sendVerificationEmail({
				email,
				callbackURL: `${window.location.origin}/login`,
			});
			setLastSentAt(Date.now());
			toast.success(m.auth_verify_email_resent_toast());
		} catch {
			toast.error(m.auth_verify_email_resend_error());
		} finally {
			setResending(false);
		}
	}

	const cooldownActive = !ready && secondsRemaining > 0;

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<Mail className="size-6" />
					</div>
					<CardTitle className="text-xl">Controlla la tua email</CardTitle>
					<CardDescription>
						{email ? (
							<>
								Abbiamo inviato un link di verifica a{" "}
								<span className="font-medium text-foreground">{email}</span>
							</>
						) : (
							"Ti abbiamo inviato un link di verifica via email."
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-center text-sm text-muted-foreground">
						Clicca sul link nell'email per verificare il tuo account e
						completare la registrazione.
					</p>

					{email && (
						<Button
							variant="outline"
							className="w-full"
							onClick={handleResend}
							disabled={cooldownActive || resending}
						>
							{resending
								? "Invio in corso..."
								: cooldownActive
									? m.auth_verify_email_resend_cooldown({
											seconds: String(secondsRemaining),
										})
									: "Reinvia email di verifica"}
						</Button>
					)}

					<div className="border-t pt-4">
						<Link to="/login" className="block">
							<Button variant="ghost" className="w-full">
								Torna al login
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
```

E aggiorna l'import header del file da:

```ts
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
```

a:

```ts
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { useCooldown } from "@bibs/ui/hooks/use-cooldown";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";
```

Rimuovi anche `const [resent, setResent] = useState(false);` e tutto il blocco `{resent && (...)}` perché ora la feedback è via toast.

- [ ] **Step 2: Verificare che `sonner` Toaster sia montato a livello app**

Run: `grep -rn "Toaster" apps/seller/src/ 2>&1 | head -5`

Expected: trovare un `<Toaster />` in `__root.tsx` o `routes/_root` (Toast pattern bibs già consolidato perché toast è già usato da altri features). Se non c'è, aggiungerlo a `apps/seller/src/routes/__root.tsx` (o equivalente):

```tsx
import { Toaster } from "sonner";
// ... dentro il return del root component:
<Toaster richColors position="top-right" />
```

Idem per customer. Se l'app già usa toast (`grep -rn "toast.success\|toast.error" apps/{seller,customer}/src/`), il Toaster è già montato e questo step è no-op.

- [ ] **Step 3: Aggiornare `apps/customer/src/routes/verify-email.tsx`**

Sostituisci tutto il contenuto del file (lines 1-99) con:

```tsx
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { useCooldown } from "@bibs/ui/hooks/use-cooldown";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

const searchSchema = z.object({
	email: z.string().optional(),
});

export const Route = createFileRoute("/verify-email")({
	validateSearch: searchSchema,
	component: VerifyEmailPage,
});

function VerifyEmailPage() {
	const { email } = Route.useSearch();
	const [lastSentAt, setLastSentAt] = useState<number>(() => Date.now());
	const { secondsRemaining, ready } = useCooldown(lastSentAt, 60_000);
	const [resending, setResending] = useState(false);

	async function handleResend() {
		if (!email || !ready || resending) return;
		setResending(true);
		try {
			await authClient.sendVerificationEmail({
				email,
				callbackURL: `${window.location.origin}/login`,
			});
			setLastSentAt(Date.now());
			toast.success(m.auth_verify_email_resent_toast());
		} catch {
			toast.error(m.auth_verify_email_resend_error());
		} finally {
			setResending(false);
		}
	}

	const cooldownActive = !ready && secondsRemaining > 0;

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<Mail className="size-6" />
					</div>
					<CardTitle className="text-xl">Controlla la tua email</CardTitle>
					<CardDescription>
						{email ? (
							<>
								Abbiamo inviato un link di verifica a{" "}
								<span className="font-medium text-foreground">{email}</span>
							</>
						) : (
							"Ti abbiamo inviato un link di verifica via email."
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-center text-sm text-muted-foreground">
						Clicca sul link nell'email per verificare il tuo account.
					</p>

					{email && (
						<Button
							variant="outline"
							className="w-full"
							onClick={handleResend}
							disabled={cooldownActive || resending}
						>
							{resending
								? "Invio in corso..."
								: cooldownActive
									? m.auth_verify_email_resend_cooldown({
											seconds: String(secondsRemaining),
										})
									: "Reinvia email di verifica"}
						</Button>
					)}

					<div className="border-t pt-4">
						<Link to="/login" className="block">
							<Button variant="ghost" className="w-full">
								Torna al login
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
```

Differenze rispetto al seller (Step 1): solo il body text del paragrafo ("Clicca sul link nell'email per verificare il tuo account." vs "...e completare la registrazione."). Tutto il resto è identico — compreso il `callbackURL` esplicito (l'attuale file customer non lo passa; ora lo passa, per coerenza col connector).

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`

Expected: 0 errori.

- [ ] **Step 5: Commit**

```bash
git add apps/seller/src/routes/verify-email.tsx apps/customer/src/routes/verify-email.tsx
git commit -m "$(cat <<'EOF'
feat(auth): cooldown 60s + toast feedback su pulsante resend verify-email

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Verification before completion

**Files:** nessuna modifica di codice.

- [ ] **Step 1: Typecheck globale**

Run dalla root: `bun run typecheck`

Expected: 0 errori in tutto il monorepo. Se ci sono errori non riconducibili a questo lavoro (es. drift di un altro PR), fermarsi e investigare prima di considerare il task done.

- [ ] **Step 2: Lint**

Run: `bun run lint`

Expected: 0 errori. (Biome auto-fix dovrebbe aver già risolto la maggior parte durante gli Edit; rimangono solo i lint che richiedono review.)

- [ ] **Step 3: Test API**

Run: `bun test apps/api/`

Expected: tutti i test passano, incluso i 6 nuovi di `registration-pending-email.test.ts` e i 5 nuovi in `registration.test.ts`. **Verifica esplicita** dei contatori — `bun --filter` aggrega output e può nascondere fallimenti singoli (memoria [[feedback_bun_filter_exit_codes]]).

- [ ] **Step 4: Verifica OpenAPI**

Run in due terminali separati:
```bash
# terminal 1
bun run dev:api  # avvia API su :3000
```

```bash
# terminal 2 (dopo che API è up)
curl -s http://localhost:3000/openapi | jq '.paths."/api/register/seller".post.responses."409"'
```

Expected: il response 409 dichiara uno schema `ConflictError` che ammette `error: ["CONFLICT", "EMAIL_ALREADY_REGISTERED", "EMAIL_PENDING_VERIFICATION"]` (Union literal) e ha `resentAt: string` opzionale. Idem per `/api/register/customer`.

- [ ] **Step 5: Manuale su `dev:seller` (porta 3002)**

```bash
bun run dev:seller
```

Poi nel browser su `http://localhost:3002/register`:

1. **Regression — signup fresh**: registra una nuova email (es. `seller-test-1@bibs.local`) con password `Test1234`. Verifica redirect a `/verify-email?email=seller-test-1@bibs.local`. ✅
2. **Pending re-signup**: torna su `/register`. Ri-inserisci `seller-test-1@bibs.local` con password (anche diversa). Submit. Verifica:
   - Il form NON viene resettato (l'email è ancora visibile)
   - Sotto il form appare il banner "Conferma la tua email" con titolo + body che cita l'email
   - Il bottone "Re-invia il link" è disabilitato e mostra "Re-invia tra Ns" (N=60 al primo render)
3. **Cooldown countdown**: aspetta che N scenda a 0. Il bottone si abilita.
4. **Click "Re-invia il link"**: appare un toast "Email di verifica rispedita". Cooldown riparte da 60s.
5. **Click "Hai dimenticato la password?"**: navigazione a `/forgot-password?email=…`. La route non esiste → atterra in 404. Comportamento atteso (out of scope).
6. **Click "Usa un'altra email"**: il banner sparisce, il form torna pulito e editabile.

- [ ] **Step 6: Manuale su `dev:customer` (porta 3001)**

Mirror del Step 5 sul portale customer. Comportamento atteso: identico.

- [ ] **Step 7: Manuale su `/verify-email` (entrambe le app)**

Vai su `http://localhost:3002/verify-email?email=qualsiasi@email.it`. Click "Reinvia email di verifica". Verifica:
- Cooldown 60s sul bottone (label cambia in "Re-invia tra Ns")
- Toast success/error coerente (no più silent fail)

- [ ] **Step 8: Open question — Better Auth token invalidation**

Risolvere l'unica open question residua dello spec:

```bash
grep -rn "verification" node_modules/better-auth/dist/api/routes/verify-email.* 2>&1 | head -20
```

Oppure consulta i docs Better Auth via MCP: `mcp__better-auth__search_docs("sendVerificationEmail token invalidation")`.

Esito previsto: il comportamento di Better Auth 1.6.11 può variare. Aggiornare il test `it("returns 409 EMAIL_PENDING_VERIFICATION ...")` in `registration.test.ts` con una nota inline se i vecchi token vengono effettivamente invalidati. **Non-blocking**: i test che abbiamo non dipendono da questa proprietà.

- [ ] **Step 9: Update memory se trovi qualcosa di sorprendente**

Se durante l'esecuzione emerge un comportamento Better Auth non documentato, oppure un pattern bibs non in memoria (es. nuovo modo di consumare Paraglide), salvare in memory file `feedback_*.md`. Non duplicare informazioni già nel codebase / git history.

- [ ] **Step 10: Push del branch e PR**

```bash
git push -u origin feat/auth-pending-email-resend
gh pr create --title "feat(auth): resend link di verifica su signup pending (seller + customer)" --body "$(cat <<'EOF'
## Summary
- Backend: nuovo error code `EMAIL_PENDING_VERIFICATION` (409) con `resentAt` nel body. `registerUser` switch a 4 rami: re-invia link entro 7gg, cleanup cascade oltre 7gg, conflict 409 se verified.
- Frontend (seller + customer): banner inline sul form di registrazione con cooldown 60s + link "forgot password" / "usa un'altra email".
- Hook `useCooldown` + componente `PendingVerificationBanner` in `@bibs/ui` per riuso futuro.
- Pagina `/verify-email`: stesso cooldown + toast feedback (oggi era silent fail).
- Nessuna migration DB (la tabella `verification` di Better Auth non ha FK su user).

## Test plan
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun test apps/api/` (11 nuovi test: 6 unit decideExistingUser + 5 route-level)
- [ ] Manual smoke: signup duplicato su `/register` (seller :3002 e customer :3001) mostra banner, cooldown 60s funziona, "Usa un'altra email" resetta
- [ ] Manual smoke: `/verify-email` ha cooldown + toast invece di silent fail
- [ ] OpenAPI `/api/register/{seller,customer}` espone i due 409 distinti

Spec: `docs/superpowers/specs/2026-05-24-pending-email-resend-design.md`
Plan: `docs/superpowers/plans/2026-05-25-pending-email-resend.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR creata. Stampa l'URL all'utente.

---

## Trade-off di test coverage rispetto allo spec

Lo spec elencava 7 test case da scrivere in un file `pending-email.test.ts` con setup tipo "signup seller/X, mutate `createdAt = now()-8d` in DB, re-signup nuova password → assert 200 + vecchio user.id non esiste più". Quelli sono **integration test con DB reale o mock pesante** (`@/db`, `@/lib/auth`).

Il piano sceglie una strategia leggermente diversa, allineata al pattern bibs esistente (`apps/api/tests/modules/registration.test.ts` mocca al livello `services`, non al livello `db`):

| Spec test case | Strategia nel piano | Coverage |
|---|---|---|
| Resend entro 7gg | Task 8 (decideExistingUser) + Task 9 (route propaga errore + resentAt) | ✅ logico + propagazione errore. ❌ non verifica che sendVerificationEmail venga effettivamente chiamato dal service |
| Verified conflict | Task 8 + Task 9 | ✅ logico + propagazione |
| TTL expired (DELETE + signup nuovo) | Task 8 (decisione pending-expired) | ⚠️ verifica solo la decisione, non l'esecuzione del DELETE |
| Boundary inclusivo | Task 8 (2 test boundary, -1ms e =7gg) | ✅ |
| Cascade integrity (seller_profile cancellato) | Non coperto | ❌ richiede integration test |
| Cross-role customer | Task 9 | ✅ |
| Mail send fallisce | Non coperto | ❌ richiede mock service-level di auth.api |

**Razionale**: bibs non ha oggi un'infrastruttura di testcontainer per gli endpoint che usano `auth.api.signUpEmail` (vedi nota TODO in `apps/api/tests/modules/registration.test.ts:311-318`). Replicarla solo per questo fix sarebbe sproporzionato. La logica chiave (`decideExistingUser` pure function) è coperta esaustivamente; la propagazione degli errori è coperta al route layer.

**Se l'esecutore vuole comunque coprire i 3 casi mancanti**: aggiungere un nuovo file `apps/api/tests/modules/registration-service-pending.test.ts` con:
- `mock.module("@/db", () => ({ db: { query: { user: { findFirst: mock(...) } }, delete: mock(...), transaction: mock(...) } }))`
- `mock.module("@/lib/auth", () => ({ auth: { api: { signUpEmail: mock(...), sendVerificationEmail: mock(...) } } }))`
- Import `registerSeller` e chiamarla direttamente

Lasciato a discrezione dell'esecutore. Se viene aggiunto, fare commit separato `test(api): integration test service-level per registerUser pending`.

---

## Note finali per l'esecutore

- **PR-first workflow**: ogni commit va sul branch `feat/auth-pending-email-resend`, mai diretto su `main` (memoria [[feedback_pr_first_workflow]]).
- **Nessun `--no-verify`**: Lefthook runs Biome pre-commit e commit-msg validation. Se un hook fallisce, fixa e re-commit, non bypassare.
- **bun --filter exit codes** (memoria [[feedback_bun_filter_exit_codes]]): se usi `bun run --filter '*' test` o simili, controlla esplicitamente `$?` per ogni workspace.
- **Schema changes liberi** (memoria [[project_dev_stage_no_prod]]): bibs è in dev, niente backfill da pianificare anche per future evoluzioni del fix.
- **Se trovi che `Alert` di shadcn non ha la variant giusta**: usa la default (neutra). Il banner è "informativo" non destructive.
- **Se `okRes(t.Any())` rompe il typecheck in Task 7**: usare uno schema TypeBox più stretto (vedi nota inline nel task). È OpenAPI cosmetics, non comportamentale.
- **Verifica della "memory" mid-task**: durante l'esecuzione, se trovi cose sorprendenti, salva nella memoria `~/.claude/projects/-Users-marcogelli-repos-jelaz-bibs/memory/` (vedi sezione "auto memory" nel system prompt).
