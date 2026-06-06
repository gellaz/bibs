# Dev Email DX (Mailpit + @bibs/emails) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In dev le email finiscono in una inbox Mailpit locale (UI :8025) invece che nel log, e i template migrano in un workspace `@bibs/emails` basato su react-email 6 con preview server.

**Architecture:** Mailpit come terzo container in `compose.yml`; il branch `development` di `sendEmail()` fa un raw `fetch` verso `POST /api/v1/send` di Mailpit (zero nuove deps, speculare al path Resend di prod) con fallback al log se il container è giù. I template diventano componenti react-email in `packages/emails`, che espone funzioni `render*` già renderizzate — `apps/api` non importa mai React.

**Tech Stack:** Mailpit v1.30.x (docker), react-email ^6.0.0 (package unificato: componenti + `render` da `'react-email'`, CLI `email`), Bun workspaces + catalog, bun:test.

**Spec:** `docs/superpowers/specs/2026-06-06-dev-email-dx-design.md`
**Branch:** `dev-email-dx` (già attivo)

**Vincoli repo (CLAUDE.md):** mai `--no-verify`; deps condivise nel root `catalog:`; mai editare `bun.lock` a mano (usa `bun install`); Biome auto-fix gira sugli Edit/Write.

---

### Task 1: Mailpit in compose.yml

**Files:**
- Modify: `compose.yml`

- [ ] **Step 1: Aggiungi il servizio e il volume**

In `compose.yml`, dopo il blocco `bibs-minio` (prima di `volumes:`), aggiungi:

```yaml
  bibs-mailpit:
    image: axllent/mailpit:v1.30
    container_name: bibs-mailpit
    ports:
      - "8025:8025" # web UI + REST API
      - "1025:1025" # SMTP (non usato dal nostro path HTTP, esposto per tool futuri)
    environment:
      # Default = file temporaneo auto-cancellato; con MP_DATABASE la posta
      # sopravvive ai restart (e `infra:reset` la pulisce insieme a DB e MinIO).
      - MP_DATABASE=/data/mailpit.db
    volumes:
      - bibs-mailpit-data:/data
    # Healthcheck built-in nell'immagine (HEALTHCHECK CMD ["/mailpit", "readyz"]):
    # `docker compose up --wait` lo rispetta senza config extra.
```

E nel blocco `volumes:` finale aggiungi:

```yaml
  bibs-mailpit-data:
```

- [ ] **Step 2: Verifica la sintassi e l'avvio**

Run: `docker compose config --quiet && docker compose up -d --wait bibs-mailpit && curl -s http://localhost:8025/readyz`
Expected: nessun errore di parsing; container healthy; `curl` risponde `ok` (HTTP 200).

- [ ] **Step 3: Commit**

```bash
git add compose.yml
git commit -m "feat(infra): add Mailpit dev email catcher to compose"
```

---

### Task 2: Trasporto dev verso Mailpit in email.ts (TDD)

**Files:**
- Modify: `apps/api/src/lib/email.ts`
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/.env.example`
- Test: `apps/api/tests/lib/email.test.ts` (nuovo)

Nota di design: niente `mock.module` nei test unit (la suite `test:unit` gira in un solo processo Bun e i mock di modulo leakano tra file — oggi `mock.module` è usato solo in `tests/integration`, che è un processo separato). Si testano le funzioni esportate `toMailpitPayload` (pura) e `sendEmailToMailpit` (con `globalThis.fetch` stubbato e ripristinato). Il branching su `NODE_ENV` in `sendEmail` resta un if/else banale verificato dallo smoke test (Task 6).

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `apps/api/tests/lib/email.test.ts`:

```ts
import { afterEach, describe, expect, it, mock } from "bun:test";
import { sendEmailToMailpit, toMailpitPayload } from "@/lib/email";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

const params = {
	to: "user@test.com",
	subject: "Oggetto di prova",
	html: "<p>Ciao</p>",
};

describe("toMailpitPayload", () => {
	it("maps our lowercase params to Mailpit's PascalCase send body", () => {
		expect(toMailpitPayload(params)).toEqual({
			From: { Email: "noreply@bibs.it", Name: "bibs" },
			To: [{ Email: "user@test.com" }],
			Subject: "Oggetto di prova",
			HTML: "<p>Ciao</p>",
		});
	});
});

describe("sendEmailToMailpit", () => {
	it("POSTs the payload to {baseUrl}/api/v1/send and returns true on 2xx", async () => {
		const fetchMock = mock(
			async () =>
				new Response(JSON.stringify({ ID: "abc123" }), { status: 200 }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const delivered = await sendEmailToMailpit(
			params,
			"http://mailpit.test:8025",
		);

		expect(delivered).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("http://mailpit.test:8025/api/v1/send");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual(toMailpitPayload(params));
	});

	it("returns false when Mailpit is unreachable (fetch rejects)", async () => {
		globalThis.fetch = mock(async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;

		expect(await sendEmailToMailpit(params, "http://mailpit.test:8025")).toBe(
			false,
		);
	});

	it("returns false on a non-2xx response", async () => {
		globalThis.fetch = mock(
			async () => new Response("boom", { status: 500 }),
		) as unknown as typeof fetch;

		expect(await sendEmailToMailpit(params, "http://mailpit.test:8025")).toBe(
			false,
		);
	});
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd apps/api && bun test tests/lib/email.test.ts`
Expected: FAIL — `email.ts` non esporta `toMailpitPayload` / `sendEmailToMailpit` (SyntaxError "export not found" o simile).

- [ ] **Step 3: Implementa il trasporto**

Sostituisci interamente `apps/api/src/lib/email.ts` con:

```ts
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

interface SendEmailParams {
	to: string;
	subject: string;
	html: string;
}

const DEFAULT_MAILPIT_URL = "http://localhost:8025";

/** Maps our params to Mailpit's PascalCase `POST /api/v1/send` JSON body. */
export function toMailpitPayload({ to, subject, html }: SendEmailParams) {
	return {
		From: { Email: "noreply@bibs.it", Name: "bibs" },
		To: [{ Email: to }],
		Subject: subject,
		HTML: html,
	};
}

/**
 * Dev-only: submit the email to the local Mailpit catcher (web UI on :8025).
 * Best-effort — returns false instead of throwing, so `bun run dev` without
 * the docker infra keeps working (the caller falls back to logging).
 */
export async function sendEmailToMailpit(
	params: SendEmailParams,
	baseUrl: string,
): Promise<boolean> {
	try {
		const res = await fetch(`${baseUrl}/api/v1/send`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(toMailpitPayload(params)),
			signal: AbortSignal.timeout(2000),
		});
		if (!res.ok) throw new Error(`Mailpit responded ${res.status}`);
		return true;
	} catch (err) {
		logger.warn(
			{ err },
			"⚠️ Mailpit unreachable — falling back to log output",
		);
		return false;
	}
}

/**
 * Sends an email.
 * - In development: delivers to the local Mailpit catcher (web UI on :8025);
 *   falls back to logging the content if Mailpit is down.
 * - In test: logs the email content (no external service needed).
 * - In production: sends via Resend API.
 */
export async function sendEmail({ to, subject, html }: SendEmailParams) {
	if (env.NODE_ENV === "development") {
		const mailpitUrl = env.MAILPIT_URL ?? DEFAULT_MAILPIT_URL;
		const delivered = await sendEmailToMailpit(
			{ to, subject, html },
			mailpitUrl,
		);
		if (delivered) {
			logger.info({ to, subject, mailpitUrl }, "📧 Email delivered to Mailpit");
			return;
		}
	}

	if (env.NODE_ENV !== "production") {
		logger.info(
			{ to, subject, html },
			"📧 Email (dev mode — not actually sent)",
		);
		return;
	}

	if (!env.RESEND_API_KEY) {
		logger.warn({ to, subject }, "⚠️ RESEND_API_KEY not set — email not sent");
		return;
	}

	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
		},
		body: JSON.stringify({
			from: env.EMAIL_FROM ?? "bibs <noreply@bibs.it>",
			to,
			subject,
			html,
		}),
	});

	if (!res.ok) {
		const body = await res.text();
		logger.error(
			{ to, subject, status: res.status, body },
			"Failed to send email via Resend",
		);
	}
}
```

(Il blocco Resend è invariato rispetto all'attuale; cambia solo il ramo non-production.)

- [ ] **Step 4: Aggiungi MAILPIT_URL a env.ts**

In `apps/api/src/lib/env.ts`, nello schema dopo la riga `EMAIL_FROM: t.Optional(t.String()),` aggiungi:

```ts
	MAILPIT_URL: t.Optional(t.String()),
```

E nell'oggetto `env` esportato, dopo `EMAIL_FROM: process.env.EMAIL_FROM,` aggiungi:

```ts
	MAILPIT_URL: process.env.MAILPIT_URL,
```

- [ ] **Step 5: Documenta in .env.example**

In `apps/api/.env.example`, dopo la riga `PORT=3000` aggiungi:

```bash

# Mailpit — dev email catcher (web UI: http://localhost:8025)
# MAILPIT_URL=http://localhost:8025   (default; override solo se Mailpit gira altrove)
```

- [ ] **Step 6: Esegui i test e verifica che passino**

Run: `cd apps/api && bun test tests/lib/email.test.ts`
Expected: PASS (4 test).

- [ ] **Step 7: Typecheck + suite unit completa**

Run: `cd apps/api && bun run typecheck && bun run test:unit`
Expected: 0 errori di tipo; tutti i test unit verdi (verifica `$?` esplicitamente).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/email.ts apps/api/src/lib/env.ts apps/api/.env.example apps/api/tests/lib/email.test.ts
git commit -m "feat(api): deliver dev emails to Mailpit with log fallback"
```

---

### Task 3: Workspace packages/emails con react-email 6

**Files:**
- Modify: `package.json` (root — catalog + scripts)
- Create: `packages/emails/package.json`
- Create: `packages/emails/tsconfig.json`
- Create: `packages/emails/emails/verification-email.tsx`
- Create: `packages/emails/emails/employee-invite-email.tsx`
- Create: `packages/emails/src/index.tsx`
- Test: `packages/emails/tests/render.test.tsx` (nuovo)

Superficie react-email 6 (verificata su docs ufficiali via context7, 2026-06-06): componenti **e** `render` si importano tutti da `'react-email'` (il package è unificato in v6; `@react-email/components` non serve più). La CLI è il binario `email`: `email dev --dir <path> --port <port>`. Il default port della preview è 3000 (occupato dall'API) → usare **3004**.

- [ ] **Step 1: Aggiungi react-email al catalog e gli script root**

In `package.json` (root), nel blocco `catalog:` aggiungi in ordine alfabetico (tra `react-easy-crop` e `react-hook-form`):

```json
		"react-email": "^6.0.0",
```

Negli `scripts` root aggiungi dopo `"dev:admin"`:

```json
		"dev:emails": "bun run --filter @bibs/emails dev",
```

E sostituisci lo script `"test"`:

```json
		"test": "bun run --filter @bibs/emails test && bun run --filter @bibs/api test",
```

(Chaining esplicito con `&&`, non `--filter '*'`: l'output aggregato di `--filter` può nascondere il fallimento di un singolo workspace.)

- [ ] **Step 2: Crea il package**

Crea `packages/emails/package.json`:

```json
{
	"name": "@bibs/emails",
	"version": "0.0.1",
	"type": "module",
	"private": true,
	"scripts": {
		"dev": "email dev --dir ./emails --port 3004",
		"test": "bun test",
		"typecheck": "tsc --noEmit"
	},
	"dependencies": {
		"react": "catalog:",
		"react-dom": "catalog:",
		"react-email": "catalog:"
	},
	"devDependencies": {
		"@types/react": "catalog:",
		"bun-types": "^1.3.14"
	},
	"exports": {
		".": "./src/index.tsx"
	}
}
```

(`react`/`react-dom` come dependencies normali, non peer: a differenza di `@bibs/ui` — consumato da app React che devono allineare la propria copia — qui il consumer è `apps/api`, che non ha React; il render avviene tutto dentro il package.)

Crea `packages/emails/tsconfig.json`:

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"target": "ES2022",
		"lib": ["ES2022", "DOM"],
		"module": "ESNext",
		"moduleResolution": "bundler",
		"jsx": "react-jsx",
		"isolatedModules": true,
		"types": ["bun-types"]
	},
	"include": ["src/**/*", "emails/**/*", "tests/**/*"],
	"exclude": ["node_modules"]
}
```

- [ ] **Step 3: Installa**

Run: `bun install` (dalla root)
Expected: lockfile aggiornato senza errori; `packages/emails/node_modules` risolto. (Mai editare `bun.lock` a mano.)

- [ ] **Step 4: Scrivi i test di render che falliscono**

Crea `packages/emails/tests/render.test.tsx`:

```tsx
import { describe, expect, it } from "bun:test";
import {
	renderEmployeeInviteEmail,
	renderVerificationEmail,
} from "../src/index";

describe("renderVerificationEmail", () => {
	it("renders subject and html containing name and verify link", async () => {
		const { subject, html } = await renderVerificationEmail({
			name: "Mario Rossi",
			verifyUrl: "https://example.test/verify?token=abc123",
		});

		expect(subject).toBe("Verifica la tua email su bibs");
		expect(html).toContain("Mario Rossi");
		expect(html).toContain("https://example.test/verify?token=abc123");
	});
});

describe("renderEmployeeInviteEmail", () => {
	it("renders subject and html containing business name, link and expiry", async () => {
		const { subject, html } = await renderEmployeeInviteEmail({
			businessName: "Libreria Esempio",
			inviteUrl: "https://example.test/invite/tok-456",
			expiryDays: 7,
		});

		expect(subject).toBe(
			"Libreria Esempio ti ha invitato a collaborare su bibs",
		);
		expect(html).toContain("Libreria Esempio");
		expect(html).toContain("https://example.test/invite/tok-456");
		expect(html).toContain("7");
	});
});
```

- [ ] **Step 5: Esegui i test e verifica che falliscano**

Run: `cd packages/emails && bun test`
Expected: FAIL — `../src/index` non esiste ancora ("Cannot find module" o simile).

- [ ] **Step 6: Crea i template**

Crea `packages/emails/emails/verification-email.tsx` (copy identica all'attuale inline di `auth.ts`):

```tsx
import { Body, Html, Link, Text } from "react-email";

export interface VerificationEmailProps {
	name: string;
	verifyUrl: string;
}

export default function VerificationEmail({
	name,
	verifyUrl,
}: VerificationEmailProps) {
	return (
		<Html lang="it">
			<Body>
				<Text>Ciao {name},</Text>
				<Text>Clicca sul link per verificare il tuo indirizzo email:</Text>
				<Text>
					<Link href={verifyUrl}>{verifyUrl}</Link>
				</Text>
			</Body>
		</Html>
	);
}

// Props mostrate dal preview server (`bun run dev:emails`)
VerificationEmail.PreviewProps = {
	name: "Mario Rossi",
	verifyUrl: "http://localhost:3000/auth/api/verify-email?token=esempio",
} satisfies VerificationEmailProps;
```

Crea `packages/emails/emails/employee-invite-email.tsx` (copy identica all'attuale inline di `employees.ts`):

```tsx
import { Body, Html, Link, Text } from "react-email";

export interface EmployeeInviteEmailProps {
	businessName: string;
	inviteUrl: string;
	expiryDays: number;
}

export default function EmployeeInviteEmail({
	businessName,
	inviteUrl,
	expiryDays,
}: EmployeeInviteEmailProps) {
	return (
		<Html lang="it">
			<Body>
				<Text>Ciao,</Text>
				<Text>
					<strong>{businessName}</strong> ti ha invitato a collaborare come
					membro del team su bibs.
				</Text>
				<Text>Clicca sul link seguente per creare la tua password e accedere:</Text>
				<Text>
					<Link href={inviteUrl}>{inviteUrl}</Link>
				</Text>
				<Text>Il link scade tra {expiryDays} giorni.</Text>
				<Text>
					Se non conosci {businessName} o non ti aspettavi questo invito, puoi
					ignorare questa email.
				</Text>
			</Body>
		</Html>
	);
}

// Props mostrate dal preview server (`bun run dev:emails`)
EmployeeInviteEmail.PreviewProps = {
	businessName: "Libreria Esempio",
	inviteUrl: "http://localhost:3002/invite/esempio-token",
	expiryDays: 7,
} satisfies EmployeeInviteEmailProps;
```

- [ ] **Step 7: Crea l'API pubblica del package**

Crea `packages/emails/src/index.tsx`:

```tsx
import { render } from "react-email";
import EmployeeInviteEmail, {
	type EmployeeInviteEmailProps,
} from "../emails/employee-invite-email";
import VerificationEmail, {
	type VerificationEmailProps,
} from "../emails/verification-email";

export interface RenderedEmail {
	subject: string;
	html: string;
}

/** Email di verifica indirizzo inviata alla registrazione (customer e seller). */
export async function renderVerificationEmail(
	props: VerificationEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: "Verifica la tua email su bibs",
		html: await render(<VerificationEmail {...props} />),
	};
}

/** Invito di un dipendente a unirsi al team di un venditore. */
export async function renderEmployeeInviteEmail(
	props: EmployeeInviteEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: `${props.businessName} ti ha invitato a collaborare su bibs`,
		html: await render(<EmployeeInviteEmail {...props} />),
	};
}

export type { EmployeeInviteEmailProps, VerificationEmailProps };
```

- [ ] **Step 8: Esegui i test e verifica che passino**

Run: `cd packages/emails && bun test`
Expected: PASS (2 test). Se l'import `{ render } from "react-email"` fallisse (superficie v6 diversa dall'atteso), verifica gli export reali con `cat node_modules/react-email/package.json | jq .exports` e adegua l'import — ma NON ripiegare su `@react-email/render` senza prima controllare.

- [ ] **Step 9: Typecheck monorepo + smoke del preview server**

Run: `bun run typecheck`
Expected: 0 errori in tutti i workspace (incluso il nuovo).

Run: `bun run dev:emails` (in background), attendi ~10-20s il primo build, poi `curl -s -o /dev/null -w '%{http_code}' http://localhost:3004`
Expected: `200`. Apri http://localhost:3004 e verifica che i 2 template compaiano con le PreviewProps. Poi termina il processo.

- [ ] **Step 10: Commit**

```bash
git add package.json bun.lock packages/emails
git commit -m "feat(emails): add @bibs/emails workspace with react-email templates"
```

---

### Task 4: Wiring dei call site in apps/api

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/lib/auth.ts` (blocco `sendVerificationEmail`, ~righe 70-84)
- Modify: `apps/api/src/modules/seller/services/employees.ts` (~righe 138-153)

Nota: `tests/integration/seller-employees.test.ts` mocka l'intero modulo `@/lib/email` (`sendEmail: async () => {}`), quindi non asserisce su subject/html — il wiring non lo rompe, ma il render vero verrà eseguito nel test. Verificare comunque con la suite.

- [ ] **Step 1: Aggiungi la dipendenza workspace e abilita jsx nel tsconfig**

In `apps/api/package.json`, nelle `dependencies` aggiungi (ordine alfabetico, prima di `@elysiajs/cors`):

```json
		"@bibs/emails": "workspace:*",
```

In `apps/api/tsconfig.json`, nelle `compilerOptions` aggiungi (dopo `"moduleResolution": "bundler",`):

```json
		"jsx": "react-jsx",
```

Motivo: l'export `.` di `@bibs/emails` punta a `src/index.tsx` (sorgente TSX, come fa `@bibs/ui` con i frontend); il programma tsc di `apps/api` includerà quel file via import e senza l'opzione `jsx` fallirebbe con "Cannot use JSX unless the '--jsx' flag is provided". Nessun effetto sui `.ts` esistenti — l'API resta React-free a runtime.

Run: `bun install`
Expected: risoluzione workspace ok.

- [ ] **Step 2: Migra il template di verifica in auth.ts**

In `apps/api/src/lib/auth.ts` aggiungi l'import (insieme agli altri import in testa):

```ts
import { renderVerificationEmail } from "@bibs/emails";
```

Sostituisci il corpo di `sendVerificationEmail` (l'attuale blocco con `subject` e `html` inline):

```ts
		sendVerificationEmail: async ({ user, url }) => {
			// better-auth generates URLs using basePath "/api", but the handler
			// is mounted at "/auth" in Elysia, so the public path is "/auth/api/..."
			const fixed = new URL(url);
			fixed.pathname = `/auth${fixed.pathname}`;
			const verifyUrl = fixed.toString();

			const { subject, html } = await renderVerificationEmail({
				name: user.name,
				verifyUrl,
			});
			await sendEmail({ to: user.email, subject, html });
		},
```

- [ ] **Step 3: Migra il template di invito in employees.ts**

In `apps/api/src/modules/seller/services/employees.ts` aggiungi l'import:

```ts
import { renderEmployeeInviteEmail } from "@bibs/emails";
```

Sostituisci il blocco "Send invitation email" (l'attuale `await sendEmail({...})` con l'array di `<p>` joinati):

```ts
	// Send invitation email
	const businessName = profile.organization?.businessName ?? "bibs";
	const inviteUrl = `${env.SELLER_APP_URL}/invite/${invitation.invitationToken}`;

	const { subject, html } = await renderEmployeeInviteEmail({
		businessName,
		inviteUrl,
		expiryDays: INVITATION_EXPIRY_DAYS,
	});
	await sendEmail({ to: email, subject, html });
```

- [ ] **Step 4: Typecheck + test**

Run: `bun run typecheck && cd apps/api && bun run test:unit`
Expected: 0 errori, unit verdi.

Run: `cd apps/api && bun run test:integration`
Expected: verdi (in particolare `seller-employees` e i test di registrazione). Timeout lungo (180s) — è normale.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json bun.lock apps/api/src/lib/auth.ts apps/api/src/modules/seller/services/employees.ts
git commit -m "feat(api): render transactional emails from @bibs/emails templates"
```

---

### Task 5: Documentazione (AGENTS.md, porte, ricetta E2E)

**Files:**
- Modify: `AGENTS.md` (root, sezione "Infrastructure", ~righe 268-282)
- Modify: `apps/api/AGENTS.md` (riga `infra:up` ~21; sezione env "Optional" ~600-615; sezione "Testing" ~617+)

- [ ] **Step 1: Root AGENTS.md — servizio e porta**

Nella sezione "Infrastructure", nell'elenco dei servizi di `compose.yml` aggiungi dopo la riga **bibs-minio**:

```markdown
- **bibs-mailpit** — Mailpit dev email catcher (SMTP 1025, web UI + API **8025**)
```

E nell'elenco "Dev server ports" aggiungi in coda:

```markdown
- **Mailpit UI**: 8025 (dev emails — verification links land here)
- **Email preview** (`bun run dev:emails`): 3004
```

- [ ] **Step 2: apps/api/AGENTS.md — infra, env, ricetta E2E**

Aggiorna la riga di `infra:up`:

```markdown
- `bun run infra:up` — start PostGIS (5432), MinIO (9000/9001) and Mailpit (8025/1025) containers
```

Nella lista env "Optional", sostituisci la riga di `RESEND_API_KEY` e aggiungi `MAILPIT_URL` dopo di essa:

```markdown
- `RESEND_API_KEY` — Resend API key for sending emails (production only; in dev emails are delivered to Mailpit, falling back to the log)
- `MAILPIT_URL` — Mailpit base URL for dev email delivery (default `http://localhost:8025`)
```

Nella sezione "Testing", aggiungi in coda questa sottosezione:

```markdown
### Dev emails (Mailpit)

In development every `sendEmail()` call is delivered to the local Mailpit container — web UI at <http://localhost:8025> (history, HTML rendering, clickable links). Templates live in `packages/emails` (react-email); preview them with `bun run dev:emails` (port 3004).

For browser/E2E flows (e.g. Playwright) retrieve emails via Mailpit's REST API — plain fetch, no client library:

- Latest email: `GET http://localhost:8025/api/v1/message/latest`
- By recipient: `GET http://localhost:8025/api/v1/search?query=to:"user@example.com"`
- Clear inbox (test isolation): `DELETE http://localhost:8025/api/v1/messages`

The verification link can be extracted from the `HTML` field of the message response.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md apps/api/AGENTS.md
git commit -m "docs: document Mailpit dev email flow and E2E recipes"
```

---

### Task 6: Verifica finale e smoke end-to-end

**Files:** nessuno (solo verifica)

- [ ] **Step 1: Suite completa dalla root**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: tutto verde. Controlla `$?` di ogni comando esplicitamente (l'output aggregato di bun può nascondere fallimenti).

- [ ] **Step 2: Smoke del trasporto (deterministico, senza browser)**

```bash
docker compose up -d --wait        # PostGIS + MinIO + Mailpit
curl -s -X DELETE http://localhost:8025/api/v1/messages   # inbox pulita
cd apps/api && bun -e 'import("./src/lib/email").then((m) => m.sendEmail({ to: "smoke@test.local", subject: "Smoke Mailpit", html: "<p>ciao</p>" }))'
curl -s 'http://localhost:8025/api/v1/message/latest' | head -c 400
```

Expected: l'ultimo curl restituisce un JSON con `"Subject":"Smoke Mailpit"` e `To` contenente `smoke@test.local`.

- [ ] **Step 3: Smoke del fallback**

```bash
docker compose stop bibs-mailpit
cd apps/api && bun -e 'import("./src/lib/email").then((m) => m.sendEmail({ to: "smoke@test.local", subject: "Smoke fallback", html: "<p>ciao</p>" }))'
docker compose start bibs-mailpit
```

Expected: nessun throw; nel log compaiono il warn "Mailpit unreachable" e l'email completa in formato log (comportamento attuale preservato).

- [ ] **Step 4: Smoke del flusso reale di registrazione (browser)**

1. `bun run dev:api` + `bun run dev:customer` (porte 3000/3001).
2. Registra un nuovo utente dalla UI customer (email inventata, es. `mario.smoke@test.local`).
3. Apri <http://localhost:8025>: l'email "Verifica la tua email su bibs" è in inbox, renderizzata.
4. Clicca il link di verifica dalla UI di Mailpit → la verifica va a buon fine (per i seller: onboarding avanza a `pending_personal`).

Expected: l'intero giro registrazione → inbox → click → verificato funziona senza toccare il terminale.

- [ ] **Step 5: Verifica OpenAPI invariata**

Run: `curl -s http://localhost:3000/openapi | head -c 200`
Expected: spec raggiungibile; nessun cambiamento atteso (il lavoro non tocca route).

---

## Note per l'esecutore

- Branch: `dev-email-dx`, già creato e con la spec committata. PR-first: a fine lavoro si apre una PR verso `main` (mai commit diretti su main, mai `--no-verify`).
- I bug Bun noti di react-email **non bloccano**: resend/react-email#2585 riguarda solo `bun build --compile` (qui si usa `bun run`); #2474 è specifico TanStack-Start-production (i template vivono nel path API).
- Lefthook (Biome) gira sui commit: se un commit fallisce per formattazione, lascia che l'hook corregga o esegui `bun run lint:fix`, mai bypassare.
- Lo script `email dev` al primo avvio builda la preview app: il primo `curl` su :3004 può richiedere qualche secondo in più.
