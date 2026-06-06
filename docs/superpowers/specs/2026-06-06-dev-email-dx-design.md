# Dev email DX — Mailpit + @bibs/emails (react-email)

**Data:** 2026-06-06
**Stato:** approvato (brainstorming con Marco)

## Problema

Tutte le email transazionali passano da un unico funnel — `sendEmail({to, subject, html})` in `apps/api/src/lib/email.ts` — che in sviluppo fa `logger.info({to, subject, html})`: il link di verifica registrazione finisce sepolto nell'output pino del terminale e va copiato a mano. I template sono stringhe HTML inline nel codice di servizio. In produzione il path è un raw `fetch` verso l'API Resend (nessun SDK, nessun SMTP).

Email esistenti oggi (2 call site):

- Verifica registrazione — `apps/api/src/lib/auth.ts` (`emailVerification.sendVerificationEmail`)
- Invito dipendente — `apps/api/src/modules/seller/services/employees.ts`

## Obiettivi

1. **Vedere e cliccare i link** in dev senza pescare nel log.
2. **Inbox con storico**: rendering HTML, ricerca, più destinatari, persistenza tra restart.
3. **Consumo da test E2E**: Playwright deve poter recuperare il link di verifica via API.
4. **Sviluppo template**: anteprima e iterazione sul design delle email.

## Decisioni

- **Catcher: Mailpit** (`axllent/mailpit`, v1.30.x — stable verificata 2026-05-28) come terzo container in `compose.yml`. MailHog è morto; Mailpit è lo standard 2026. Le opzioni hosted (Mailtrap/Ethereal/Resend test mode) scartate: account/quota/rete per ogni dev, contro-corrente rispetto all'infra local-first.
- **Trasporto dev: HTTP send API** (`POST /api/v1/send`, esiste da Mailpit v1.18.0, shape verificata su swagger ufficiale) invece di SMTP → **zero nuove dipendenze**, speculare al raw fetch Resend di produzione. Niente nodemailer.
- **Template: react-email 6 subito** (scelta esplicita di Marco, contro il default "defer"): nuovo workspace `packages/emails` (`@bibs/emails`). I futuri template branded (conferme d'ordine, ricevute con castelletto IVA) nasceranno già nel pattern giusto.

## Design

### 1. Infra — `compose.yml`

```yaml
bibs-mailpit:
  image: axllent/mailpit:v1.30    # pinned al minor
  container_name: bibs-mailpit
  ports:
    - "8025:8025"   # web UI + REST API
    - "1025:1025"   # SMTP (non usato dal nostro path, esposto per tool futuri)
  environment:
    - MP_DATABASE=/data/mailpit.db   # persistenza SQLite (default = temp file auto-cancellato)
  volumes:
    - bibs-mailpit-data:/data
  # healthcheck built-in nell'immagine: HEALTHCHECK CMD ["/mailpit", "readyz"]
  # (verificato nel Dockerfile ufficiale) → compatibile con `docker compose up --wait`
```

- Porte 8025/1025 libere rispetto a 3000-3003 / 5432 / 9000-9001.
- Volume `bibs-mailpit-data` nel blocco `volumes:` → `infra:reset` pulisce anche la posta, coerente con DB e MinIO.
- Niente `MP_SMTP_AUTH_*` (non usiamo SMTP); UI auth off di default; `MP_MAX_MESSAGES` default (500) sufficiente.

### 2. Trasporto dev — `apps/api/src/lib/email.ts`

Il branch non-production attuale si sdoppia per ambiente:

- **`NODE_ENV === "development"`** → `fetch` `POST ${env.MAILPIT_URL ?? "http://localhost:8025"}/api/v1/send` con adapter verso il payload PascalCase di Mailpit:

  ```jsonc
  {
    "From": { "Email": "noreply@bibs.it", "Name": "bibs" }, // da EMAIL_FROM se settata
    "To": [{ "Email": "<to>" }],
    "Subject": "<subject>",
    "HTML": "<html>"
  }
  ```

  Con `AbortSignal.timeout(2000)`. Se il fetch fallisce (container giù): `logger.warn` + fallback al `logger.info` attuale con l'html completo — `bun run dev` senza infra resta funzionante e il link greppabile. **Mai throw**: coerente con la semantica best-effort esistente (un'email fallita non rompe la signup).
- **`NODE_ENV === "test"`** → resta il `logger.info` attuale: la suite testcontainers non fa fetch che falliscono/rallentano.
- **production** → invariato (Resend).
- `MAILPIT_URL` opzionale in `env.ts`, documentata in `.env.example`.

### 3. Template — workspace `packages/emails` (`@bibs/emails`)

- **Deps**: `react-email` v6 (package unificato: componenti + render in un solo package) nel root `catalog:`; `react` già in catalog. tsconfig del package con `jsx` configurato.
- **Confine netto**: `apps/api` non importa mai React. Il package espone funzioni già renderizzate:

  ```ts
  renderVerificationEmail({ name, verifyUrl }): Promise<{ subject: string; html: string }>
  renderEmployeeInviteEmail({ businessName, inviteUrl, expiryDays }): Promise<{ subject: string; html: string }>
  ```

  Le props rispecchiano le variabili dei template inline attuali (`auth.ts`: `user.name` + `verifyUrl`; `employees.ts`: `businessName`, `inviteUrl`, `INVITATION_EXPIRY_DAYS`). Anche il `subject` migra nel package: oggi vive nei call site ed è parte del contenuto.

  I call site passano il risultato a `sendEmail()`. Il render (`react-dom/server`) avviene dentro il package.
- **Copy italiana** come props/default nei template — single-locale oggi, nessun accoppiamento Paraglide.
- **Preview server**: script root `dev:emails` → react-email `email dev` contro la cartella dei template (gira sotto Bun via `bunx`; pattern validato dall'esempio ufficiale `resend/react-email-turborepo-bun-example`).
- **Bug Bun noti, non bloccanti per noi** (verificati su GitHub):
  - resend/react-email#2585 — `render()` rotto sotto `bun build --compile`: l'API gira con `bun run`, non compiliamo binari.
  - resend/react-email#2474 — risoluzione moduli in build di produzione TanStack Start: i template vivono nel path API, non nelle app TanStack.

### 4. E2E e documentazione

Ricetta Playwright (da documentare in `apps/api/AGENTS.md`):

- Ultima email: `GET http://localhost:8025/api/v1/message/latest` (lo shorthand `latest` è verificato su swagger).
- Per destinatario: `GET /api/v1/search?query=to:"<addr>"`.
- Isolamento tra test: `DELETE /api/v1/messages` (senza body → cancella tutto).
- Tutto plain fetch, nessuna libreria client.

Aggiornare la tabella porte dev dove documentata (+ 8025 UI Mailpit).

### 5. Error handling e test

- **Adapter Mailpit**: unit test su mapping payload (lowercase → PascalCase) e fallback a logger su fetch fallito.
- **Template**: test di render in `packages/emails` — l'html contiene `verifyUrl`/nome; snapshot leggero.
- **Suite API esistente**: invariata (path logger in `NODE_ENV=test`).
- Verifica standard: `bun run typecheck`, `bun run lint`, `bun run test` + smoke browser (registrazione → email in Mailpit → click link → verifica completata).

## Fuori scope

- Email di reset password: la rate-rule `/forget-password` esiste ma il flow no; quando arriverà userà già il pattern nuovo.
- Smoke-test del path Resend reale (test addresses `delivered@resend.dev`); webhook Mailpit; chaos testing.
- i18n dei template oltre l'italiano.

## Fonti verificate (ricerca 2026-06-06)

- Mailpit v1.30.1 (2026-05-28), image Alpine ~13 MB: GitHub releases + Dockerfile ufficiale.
- `POST /api/v1/send` + payload PascalCase + risposta `{ID}`: `server/ui/api/v1/swagger.json` + docs `usage/sending-messages`.
- Healthcheck built-in `["/mailpit", "readyz"]`: Dockerfile + `cmd/readyz.go`.
- Read API (`message/latest`, `search?query=to:"…"`, `DELETE /messages`): swagger + docs `search-filters`.
- Persistenza `MP_DATABASE` (default temp auto-cancellato): docs `runtime-options`.
- react-email 6 unificato, Bun ok per `render()` + preview server: changelog react.email, docs Elysia `integrations/react-email`, esempio ufficiale Resend per monorepo Bun.
