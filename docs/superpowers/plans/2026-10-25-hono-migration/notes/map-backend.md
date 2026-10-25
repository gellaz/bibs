# apps/api: map of the Elysia HTTP layer (read-only, main @ e4be2926)

> Copiata dallo scratchpad della sessione di pianificazione il 2026-10-25, senza tagli. I percorsi `scratchpad/hono/...` citati qui ora stanno in questa cartella: vedi la sezione «Note e prototipi» di [`../../2026-10-25-hono-migration.md`](../../2026-10-25-hono-migration.md#note-e-prototipi).

Elysia 1.4.30, TypeBox 0.34.52 (same instance as Elysia's), @elysiajs/cors 1.4.x, @elysiajs/openapi 1.4.16,
@elysiajs/cron 1.4.2 (croner ^6), logixlysia 6.10.3, better-auth (catalog). All paths are relative to `apps/api/`.
Probes I ran are in `scratchpad/hono/tools/` (`routes.ts`, `compose.ts`, `xff.ts`, `csvfile.ts`). They compose
the real plugins and modules offline with fake env, never start a DB, and wrote nothing to the repo.
"Observed" below means I reproduced it with those scripts.

Endpoint totals (runtime `app.routes`): **181 real endpoints** = 179 API + `/health` + `/ready`, plus the
better-auth mount (`ALL /auth`, `ALL /auth/*`) and **10 dead duplicate mounts** (see 1.8).

---

## 1. `src/index.ts`: composition order and plugins

| # | line | plugin | what it does | scope / hooks |
|---|------|--------|--------------|---------------|
| 1 | 27-39 | `logixlysia` | per-request log `{now} {level} {duration} {method} {pathname} {status} {ip}`; stdout plus `fileTransport` (`lib/logger.ts:46-70`) to `logs/app.log`; `pino: pinoOptions` | global; onRequest (start time), onAfterHandle, onAfterResponse, onError (logs), onStart (banner), `.state` (logger) |
| 2 | 40-53 | `@elysiajs/cors` | origin fn → `isOriginAllowed` (`lib/cors.ts:20-35`), methods GET/POST/PUT/PATCH/DELETE/OPTIONS, `credentials: true`, allowedHeaders `Content-Type, Authorization`, exposeHeaders `Content-Length, X-Request-Id`, maxAge 86400 | global; answers OPTIONS preflight with 204 on any path |
| 3 | 54 | `errorHandler` (`plugins/error-handler.ts`) | turns every error into the JSON envelope (section 1.3) | `onError({as:"global"})` |
| 4 | 55 | `requestId` (`plugins/request-id.ts`) | sets the `x-request-id` response header | `derive({as:"global"})` |
| 5 | 56 | `normalize` (`plugins/normalize.ts`) | deep-trims strings in the body before validation | `onTransform({as:"global"})` |
| 6 | 57-156 | `@elysiajs/openapi` | `/openapi` (Scalar UI, default `provider`) and `/openapi/json`; info/tags (65-142); `components` = better-auth components plus `securitySchemes.bearerAuth` (143-152); `paths: await OpenAPI.getPaths()` = better-auth paths with prefix `/auth/api`, tag "Better Auth" (`lib/auth.ts:157-180`) | builds the spec lazily from `app.routes`; mount routes are `hide: true` |
| 7 | 157 | `stripeWebhookRoutes` | 3 POST routes with raw body | n/a |
| 8 | 158 | `betterAuth` (`plugins/better-auth.ts`) | XFF overwrite, `mount("/auth", auth.handler)`, `auth` macro | onRequest (effectively global, see 1.6), mount, macro |
| 9-16 | 159-165 | registration, admin, catalog, locations, seller, customer, me | n/a | n/a |
| 17 | 166 | `cronJobs` | 5 croner jobs (1.10) | crons start when `plugins/cron.ts` is evaluated, not at listen |
| 18 | 167 | `health` | `/health`, `/ready` | n/a |

Startup: `await ensureBucket()` (170), `app.listen(PORT)` (172-173). Shutdown on SIGTERM/SIGINT runs `app.stop()`
and `db.$client.end()` (176-183). `export type App = typeof app` (186) is the Eden type, re-exported by
`src/types.ts:7` and `package.json` exports `"."`.

**Ordering dependencies**
- Elysia applies hooks only to routes registered after them. errorHandler, requestId and normalize must stay
  before every module. They are `as:"global"`, so they also reach routes inside nested plugins.
- `requestId` is a **derive**, so it runs after routing. **Unmatched routes (404) and body PARSE errors carry no
  `x-request-id`** (observed). Matched routes have it on success and on error.
- Validation runs **before** `resolve`/`beforeHandle`. Observed: an unauthenticated POST with an invalid body gets
  **422, not 401** (`/customer/addresses`, `/admin/product-categories?page=abc`, `/locations/geocode?q=a`).
  The rate limiter (`beforeHandle`) also runs after validation and after the trim, so invalid bodies do not
  consume budget.
- Inside the `beforeHandle` chain the order is: macro `auth` resolve (401), then guard `.resolve` (403 role or
  profile), then route `beforeHandle` (rate limit). `/locations/geocode` has `bh=2`: auth, then rateLimit.
- CORS headers are present on every response, including 404s and responses from mounts (observed).
  `access-control-allow-methods/headers` also appear on non-preflight responses. A disallowed origin only loses
  `access-control-allow-origin`; `vary: Origin` is always set.

### 1.1 Observed HTTP behaviour (baseline for parity)
- Unknown route, or wrong method on a known path → **404** `{"success":false,"error":"NOT_FOUND","message":"Risorsa non trovata"}` (no 405, no x-request-id).
- `HEAD /health` → 200 (Elysia serves HEAD for GET routes).
- Trailing slash is tolerated (`strictPath:false` default): `/health/` → 200. Two routes are *defined* with a
  trailing slash, `GET /admin/requests/` (`admin/routes/requests.ts:15-17`) and `GET /seller/settings/`
  (`seller/routes/settings.ts:34-36`), and the FE calls them without it (`api().admin.requests.get()`,
  `api().seller.settings.get()`).
- Malformed JSON body → **500 INTERNAL_ERROR** (Elysia code `PARSE` falls into the catch-all), with no
  x-request-id. A `text/plain` body on a JSON route → 422 (the string fails object validation).
- JSON responses: `content-type: application/json;charset=utf-8`.
- All success statuses are 200: no 201 or 204 anywhere. Non-200 responses come only from the error handler,
  `set.status` (webhooks 400/500, `/ready` 503) and the rate limiter (429).

### 1.2 How the 422 body is built
Flow: Elysia `ValidationError` → `error-handler.ts:141-178` → `errorBody("VALIDATION_ERROR", validationMessage(error))`
gives `{"success":false,"error":"VALIDATION_ERROR","message":"<Italian>"}`.
- `type === "response"` (handler output fails its schema) → **500** `INTERNAL_ERROR` "Errore interno del server", logged as an error (143-158).
- It never uses `error.message`: that is Elysia's JSON with `found` = the submitted body, passwords included (160-161).
- `lib/validation-message.ts:170-191` `validationMessage(error)` reads **only** `error.customError`, `error.valueError`
  and `error.type`:
  1. `customError` (string) wins. Elysia sets it from `valueError.schema.error` on the **first** failing error
     (`TypeCompiler.Errors(value).First()`). 38 `error: "…"` options exist in the schemas, e.g. `lib/schemas/forms/stores.ts:15`.
  2. no `valueError` → "Richiesta non valida".
  3. `valueError.path === ""` (Decode errors from t.Integer/t.Date coercion, `type === "property"`) →
     "Valore non valido" or "Valore non valido: <rule>"; any other type → "Richiesta non valida".
  4. otherwise `"<label>: <rule>"`. The label is `valueError.schema.title` (2 schemas set `title`), else
     `FIELD_LABELS[last path segment]` (9-87), with "(riga N)" when the previous segment is numeric (154-163),
     else the dotted technical path (e.g. `addressLine1`).
  - The rule comes from `lib/validation-rule.ts:40-100`. It reads `valueError.type` (the 0.34 `ValueErrorType`
    enum), `.schema` (`minLength`, `maxLength`, `format`, `minimum`, `maximum`, `exclusiveMinimum/Maximum`,
    `minItems/maxItems`, `anyOf`, `[Kind]` File/Files) and `.value` (undefined → "campo obbligatorio";
    minLength ≤ 1 → "campo obbligatorio"). Unions (t.Integer/t.Nullable/t.Date/Literal unions, type 62) are
    revalidated on the single non-null, non-coercion branch with `Value.Errors(branch, value).First()` (105-121).
    Formats: `FORMAT_RULES` (89-95) for email, uuid, calendar-date, uri, date-time.
  - The seller FE imports this file through `@bibs/api/validation-rule` (package.json exports), so it must stay
    pure TypeBox 0.34.
- `INVALID_FILE_TYPE` (Elysia sniffs magic bytes with `file-type@22` when `t.File({type})` is set) → 422
  `invalidFileTypeMessage(error.property)` (`validation-message.ts:194-197`), e.g. `body.file` → "File: tipo di file non ammesso"
  (`error-handler.ts:181-196`). An oversize `t.File` fails the Kind check, so the rule is `fileType` and the
  message is also "tipo di file non ammesso" (code reading).
- **Locale cookie: the API reads none.** No `locale` or `cookie` code exists in `src/` (grepped). 422 and every
  ServiceError message is always Italian. The Paraglide locale cookie is FE-only (PR #224), and `user.locale` is
  an open follow-up (memory "i18n history"). Parity therefore means always Italian, with no cookie branch to port.
- Verified examples: missing password → "Password: campo obbligatorio"; `email:"nope"` → "Email: indirizzo email non valido";
  `?page=abc` → "Pagina: deve essere un numero intero"; geocode `limit=2.5` → "Numero di suggerimenti: deve essere un numero intero" (title).

### 1.3 Error mapping (`plugins/error-handler.ts`), in order
| source | status | body `error` / message |
|---|---|---|
| better-auth `APIError` → `apiErrorToServiceError` (48-49, `lib/auth-errors.ts:60-77`) | by body.code: EMAIL_NOT_VERIFIED 403, BANNED_USER 403, INVALID_EMAIL_OR_PASSWORD 401; else statusCode (<500 kept, otherwise 500); 401/403 get fixed Italian texts | as ServiceError |
| `ServiceError(status, message)` (51-74) | `status` | `code` = `ERROR_CODES[status]` (`lib/errors.ts:3-16`: 400 BAD_REQUEST, 401 UNAUTHORIZED, 403 FORBIDDEN, 404 NOT_FOUND, 409 CONFLICT, 422 VALIDATION_ERROR, 429 TOO_MANY_REQUESTS, 500 INTERNAL_ERROR, 502 BAD_GATEWAY, 503 SERVICE_UNAVAILABLE); subclasses `EmailAlreadyRegisteredError` (409 EMAIL_ALREADY_REGISTERED) and `PendingVerificationError` (409 EMAIL_PENDING_VERIFICATION, adds `resentAt`) at `errors.ts:49-66`; logs warn (<500) or error |
| pg 23505 unique (80-96; unwraps one `.cause`, 30-35) | **409** | CONFLICT; message from `UNIQUE_MESSAGES[constraint]` (25-28: `product_seller_ean_unique`, `holiday_definition_unique_idx`), else "Esiste già un elemento con questi dati" |
| pg 23503 FK (101-122) | 409 if `detail` contains "is still referenced", else 400 | CONFLICT "Risorsa ancora in uso: …" / BAD_REQUEST "Riferimento non valido" |
| pg 23514 check (125-139) | 400 | BAD_REQUEST "Valore non valido per questa operazione" |
| VALIDATION (141-178) | 422, or 500 for responses | see 1.2 |
| INVALID_FILE_TYPE (181-196) | 422 | VALIDATION_ERROR |
| NOT_FOUND (198-209) | 404 | NOT_FOUND "Risorsa non trovata" |
| anything else, including PARSE (211-225) | 500 | INTERNAL_ERROR "Errore interno del server" |
Envelope: `errorBody(error, message)` = `{success:false, error, message}` (`lib/responses.ts:16-18`). The logger
comes from `getLogger(store)` (`lib/logger.ts:94-97`): `store.pino ?? store.logger.pino ?? standalone logger`.

### 1.4 X-Request-Id (`plugins/request-id.ts:8-19`)
An inbound `x-request-id` is kept if it matches `^[A-Za-z0-9._:-]{1,128}$`, otherwise it is replaced by
`crypto.randomUUID()`. It is written to `set.headers` and returned as `ctx.requestId`; **no handler or log reads
`requestId`** (grepped). It is not in the CORS allowedHeaders, so browsers cannot send it cross-origin.

### 1.5 CORS (`index.ts:40-53`, `lib/cors.ts:20-35`)
Origins: when NODE_ENV is in {development, test}, any `http://localhost(:port)` is allowed. Otherwise only the
comma-separated `ALLOWED_ORIGINS`. CI (`.github/workflows/ci.yml:131-137`) asserts that the production image does
**not** return ACAO for `Origin: http://localhost:9999` on `/ready`. Unit test: `tests/unit/cors-origin.test.ts`.

### 1.6 better-auth plugin (`plugins/better-auth.ts`)
XFF overwrite, quoted verbatim (lines 6-26):
```ts
	// Overwrite x-forwarded-for with Bun's socket peer address before
	// better-auth's rate-limiter runs. Without a resolvable client IP,
	// better-auth silently skips rate-limiting for all /auth/* paths on
	// direct (non-proxied) connections. The OVERWRITE (not set-if-absent)
	// + x-real-ip strip guarantee client-supplied values never reach the
	// limiter — a spoofed header would otherwise be a rate-limit bypass.
	// CAVEAT: dietro un reverse-proxy il socket IP è quello del proxy, quindi
	// questo hook andrà sostituito dalla trusted-proxy hardening (P3 nella gap
	// analysis) prima del deploy. Oggi bibs è esposto solo in diretta (dev).
	.onRequest(({ request, server }) => {
		const ip = server?.requestIP(request)?.address;
		if (ip) {
			const headers = new Headers(request.headers);
			headers.set("x-forwarded-for", ip);
			headers.delete("x-real-ip");
			// Reassign request with injected header so auth.handler sees it.
			// Elysia mutates ctx.request; we return a new Request so downstream
			// lifecycle hooks (including the mount handler) see the updated headers.
			Object.defineProperty(request, "headers", { value: headers });
		}
	})
```
- **Observed (real listen on port 0): the overwrite applies to EVERY route in the app**, including routes
  registered before `.use(betterAuth)` and routes in prefixed sub-apps. Spoofed `x-forwarded-for: 6.6.6.6` and
  `x-real-ip` became `::ffff:127.0.0.1` / null. With `app.handle()` (tests) `server` is null, so the hook is a no-op.
- `auth.ts:36-41` trusts `ipAddressHeaders: ["x-forwarded-for"]` because of this overwrite. better-auth's own rate
  limit is enabled with custom rules (`auth.ts:102-114`); trustedOrigins are :3001, :3002 and :3003 (150-154).
- Mount: `.mount("/auth", auth.handler)` (27). Elysia strips `/auth`, so better-auth (basePath `/api`,
  `auth.ts:31`) sees `/api/...`. The public URL is `/auth/api/*`, e.g. `GET /auth/api/ok` → `{"ok":true}`.
  Email links are rewritten to `/auth${pathname}` (`auth.ts:79-83`, 117-121). FE `authClient` baseURL is
  `${API_URL}/auth/api` (`apps/*/src/lib/auth-client.ts`).
- Macro `auth: { resolve }` (28-41): `auth.api.getSession({ headers })` (cookie session; the bearer plugin is NOT
  enabled; `bearerAuth` exists only in the OpenAPI doc). With no session → `ServiceError(401, "Devi accedere per continuare")`.
  Otherwise it returns `{ user, session }` into ctx.
- **Dead duplicate mounts**: every module that does `.use(betterAuth)` (admin, customer, locations, me, seller)
  re-registers `ALL /<prefix>/auth` and `/<prefix>/auth/*`. Elysia computes the strip length from the plugin's
  own (empty) prefix (`elysia/dist/index.mjs:1445`), so `/seller/auth/api/ok` reaches better-auth as
  `r/auth/api/ok` → **404 with an empty body** (observed). Nobody uses these routes. A Hono port would make them
  JSON 404s: an accepted delta.

### 1.7 Rate limit (`plugins/rate-limit.ts`)
`rateLimit(opts)` returns an Elysia `beforeHandle`. It keeps an in-memory fixed window per limiter (`consume`
22-45), sweeps every 60 s or above 10k keys, and uses key `` `${name}:${rule.by}:${identity}` `` (146).
`identity` is `clientIp(request, server, trustProxy)` (97-109: XFF first hop only when `TRUST_PROXY==="true"`,
else `server.requestIP`, else `"unknown"`) or `email` lowercased from the (trimmed, validated) body, else `"anonymous"` (111-114).
429: `set.status=429`, `retry-after: <s>` header, body `{success:false,error:"TOO_MANY_REQUESTS",message:"Troppe richieste. Riprova più tardi."}` (160-166).
`__clearRateLimitStores()` is test-only (93-95).

| limiter name | route | rules |
|---|---|---|
| register-customer | POST /register/customer (`registration/index.ts:57-65`) | ip 10/h, email 3/h |
| register-seller | POST /register/seller (103-109) | ip 10/h, email 3/h |
| accept-invite | POST /register/accept-invite (146-149) | ip 20/h |
| sign-in | POST /register/sign-in (183-189) | ip 30/15 min, email 10/15 min |
| geocode | GET /locations/geocode (`locations/routes/locations.ts:184-187`) | ip 30/min |

### 1.8 `/health`, `/ready` (`plugins/health.ts`)
`GET /health` → `{status:"ok"}` (7-14). `GET /ready` (15-46): `SELECT 1` plus `checkBucket()` via
`Promise.allSettled`; if either fails, `set.status = 503`. Body
`{status:"ok"|"unhealthy", services:{database:"ok"|"unreachable", s3:"ok"|"unreachable"}}`. Neither has a response
schema. CI boots the image and polls `/ready` (ci.yml:120-128).

### 1.9 OpenAPI
`/openapi` serves Scalar and `/openapi/json` serves the spec (plugin defaults, `@elysiajs/openapi` index.mjs:8058-8060).
Per-route `detail` (summary, description, tags). The guards add `detail.security: [{bearerAuth: []}]`. Route-level
`response` maps produce the documented error schemas through `withErrors` / `withConflictErrors`
(`lib/schemas/responses.ts:109-152`). Docs (`AGENTS.md:347`, `apps/api/README.md:17,73,148`) call `/openapi` the
authoritative route list.

### 1.10 Cron (`plugins/cron.ts`, `@elysiajs/cron` → `new Cron(pattern, options, run)` at plugin construction, server timezone)
| name | pattern | job |
|---|---|---|
| expireReservations | `Patterns.EVERY_MINUTE` = `*/1 * * * *` (13-28) | `lib/jobs/expire-reservations` |
| expireUnpaidOrders | every minute (30-47) | `lib/jobs/expire-unpaid-orders` |
| retryStoreTransfers | `30 * * * *` (48-69) | `lib/jobs/retry-store-transfers` |
| autoCancelSuspendedStores | `0 3 * * *` (70-92) | `jobs/auto-cancel-suspended-stores` |
| expirePendingStoreCreations | `0 * * * *` (93-115) | `jobs/expire-pending-store-creations` |
Each job is wrapped in try/catch and logs through the standalone `logger`. `croner` is only a transitive dependency
(through @elysiajs/cron). Note that apps/api/AGENTS.md:79 says "Three jobs", which is stale.

---

## 2. Auth macro and role contexts

| module | guard (file:line) | resolves | errors |
|---|---|---|---|
| admin | `admin/index.ts:22-54` `{auth:true, detail.security}` + `.resolve` | `user`, `session` (macro); role check returns `{}` | 401 no session; 403 "Accesso riservato agli amministratori" |
| seller (A) | `seller/index.ts:26-42` → profile, onboarding | `user`, `session`; `role !== "seller"` → 403 | 401; 403 "Accesso riservato ai venditori" |
| seller (B) | `seller/index.ts:44-70` → the other 15 route plugins | `resolveSellerAccess(u)` (`seller/context.ts:192-271`) → `{sellerProfile, isOwner, accessCtx:{userId,sellerProfileId,isOwner}, getStoreIds(), getAccessibleStoreIds()}` (lazy, memoised per request) | 403 "Profilo venditore non trovato" / "Onboarding del venditore non completato" / "Accesso negato: nessun incarico attivo come dipendente" / "Accesso riservato a venditori e dipendenti" |
| customer | `customer/index.ts:23-46` (products and stores stay public, 19-21) | `customerProfile` row | 401; 403 "Profilo cliente non trovato" |
| locations | per route `auth: true` on `/geocode` only (`locations/routes/locations.ts:152`) | `user` | 401 |
| me | per route `auth: true` on both avatar routes (`me/routes/avatar.ts:30,61`) | `user` | 401 |
| seller | extra `auth: true` on `/products/lookup` (`seller/routes/products.ts:188`), redundant inside guard B (getSession runs twice) | n/a | n/a |

Consumption: sub-route plugins do not see the guard's types, so handlers cast with `withSeller(ctx)` (~79 sites),
`withSellerAuth` (6), `withCustomer` (17), `withAdmin` (26), or with `ctx as typeof ctx & {user}` (me, locations).
The casts live in `*/context.ts` (`admin/context.ts:16-18`, `customer/context.ts:20-22`, `seller/context.ts:34-36,183-185`).
Seller access helpers (framework-free, DB-backed) are in `seller/context.ts`: `ensureStoreAccess` (113-128: owner
404 "Negozio non trovato", employee 403 "Accesso negato a questo negozio"), `ensureProductAccess` (137-154),
`requireOwner(isOwner)` → 403 "Solo il titolare può eseguire questa operazione" (160-166, ~43 call sites),
`getAccessibleStoreIdsFor`, `ensureStoreOwnership` and `ensureProductOwnership` (also imported by
`seller/services/{images,employees,stock}.ts`). The customer and admin resolves are inline in `index.ts` and not
extracted; seller's is (`resolveSellerAccess`, tested in `tests/integration/seller-guard-resolve.test.ts`).

---

## 3. Custom `normalize` plugin vs Elysia's built-in `normalize`

**Custom** (`plugins/normalize.ts`): a global `onTransform` (after parse, before validation) that runs
`deepTrim(body)` (7-22). It trims every string recursively, leaves Blob/File and Date alone, and **skips any key
matching `/password/i`** (better-auth login does not trim). It only touches the body, never query, params or
responses. Tests: `tests/plugins/normalize.test.ts` (2).

**Built-in** (`new Elysia()` config default `normalize: true` = exact-mirror; nothing in src overrides it; 0 explicit
`additionalProperties` in src). Elysia sets `additionalProperties:false` on the root object schema, then **Clean
(exact-mirror) runs before Check**, so unknown keys are **silently stripped, never rejected**, at every depth of
declared objects:
- **body**: observed `{"a":"1","extra":2,"nested":{"b":"2","deep":3}}` → handler sees `{"a":"1","nested":{"b":"2"}}`.
- **query**: unknown keys are dropped (`?zzz=1` → `{page:1}`).
- **response**: every declared status schema is mirrored on the way out (Clean, then Check, then 500 if still
  invalid). Observed `{a, secret, nested:{b, hidden}}` → `{a, nested:{b}}`. This is what keeps internal columns
  (`documentImageKey`, `stripeCustomerId`, ban fields, `updatedAt`…) out of responses when services return raw
  rows. Covered by **only one test** (`tests/modules/registration-response-schema.test.ts`: `documentImageKey` stripped).
- headers and params: no stripping that matters (headers schemas are not used).

Related built-in coercions to replicate (`elysia/dist/index.mjs:345-385`, `replace-schema.mjs:69-107`):
- query: `coerce:true`. `t.Number` → Numeric, `t.Boolean` → BooleanString, `t.Array` → ArrayQuery (repeated keys
  AND comma-split: `?ids=a,b` → `["a","b"]`, observed), nested objects → ObjectString. Schema **defaults are
  injected** (`page:1`, `limit:default`, `sortBy`, `sortOrder`, products `status:"active"`, geocode `limit:5`).
- params: `coerce:true`.
- multipart bodies (schemas containing File/Files): objects → ObjectString (JSON), arrays → ArrayString.
  `t.Integer` accepts `"2"`.
- JSON body: root-only primitive coercion. Elysia's `t.Integer` itself is a Union of
  `String{format:"integer"}` and `Integer` with Transform (`elysia/dist/type-system/index.mjs:77-95`), so **JSON
  `"3"` is accepted as 3 in bodies too**. `t.Date` accepts Date, date-time, date and epoch number and decodes to a Date (96-137).
- Formats: Elysia's import registers `email, uuid, uri, date, date-time, numeric, integer, boolean, ObjectString,
  ArrayString`… into TypeBox's **global** `FormatRegistry` (`type-system/format.mjs:132-170`). The app adds only
  `calendar-date` (`lib/schemas/forms/formats.ts:26`). Without Elysia loaded, `format:"email"` is an unknown format
  and fails validation.
- Custom Kinds `File`/`Files` are registered by Elysia (TypeRegistry). `t.File({type})` adds magic-byte sniffing.

---

## 4. Per module

Legend: B body, Q query, P params; "ext" = Elysia-only `t.*` (Numeric, Integer, Date, File, Files, Nullable,
MaybeEmpty, ObjectString, ArrayString, ArrayQuery, BooleanString, UnionEnum, Form, Cookie, NoValidate…) counted
in the module's route files. Shared schemas are counted separately.

| module | prefix | route files (endpoints) | total | auth | ext in route files |
|---|---|---|---|---|---|
| **me** | `/me` (`me/index.ts:5`) | avatar.ts (2) | 2 | per-route macro | 1 (t.File) |
| **locations** | `/locations` | locations.ts (6) | 6 | `/geocode` only | 1 (t.Integer) |
| **catalog** | none (root) | product-macro-categories, product-categories, store-macro-categories, store-categories (1 each) | 4 | public | 0 |
| **registration** | `/register` (`registration/index.ts:27-30`, tags Registration) | index.ts (4) | 4 | public, rate-limited | 0 |
| **webhooks** | none (root) | routes/stripe.ts (3) | 3 | Stripe signature | 0 |
| **customer** | `/customer` | products (3), stores (5) public; profile (1), addresses (4), points (1), orders (3), cart (4), checkout (4) guarded | 25 | guard | 2 (t.Integer) |
| **admin** | `/admin` (tags Admin) | product-macro-categories 3, product-categories 3, category-characteristics 4, configurations 1, store-macro-categories 3, store-categories 3, holiday-definitions 5, category-imports 2, product-characteristics 4, characteristic-imports 2, sellers 5, stores 2, seller-changes 3, requests 3 (sub-prefix `/requests`), billing 5 (sub-prefix `/billing`) | 48 | guard | 36 (23 Integer, 5 Nullable, 4 File, 4 Date) |
| **seller** | `/seller` | guard A: profile 1, onboarding 5 (`/onboarding`). Guard B: billing 4 (`/billing`), stores 9, closures 2, checkout 4, products 12, product-characteristics 1, brands 2, images 2, store-images 2, stock 5, orders 9, dashboard 1, employees 10, settings 8 (`/settings`), discounts 10 | 87 | 2 guards | 51 (24 Integer, 14 Nullable, 8 Date, 3 File, 2 Files) |
| **billing** | none | **no routes**: `billing/index.ts` only re-exports `getOrCreateStripeCustomer` (services used by seller/customer/webhooks) | 0 | n/a | 0 |
| plugins/health | root | health.ts (2) | 2 | public | 0 |

Route LOC: admin 1888, seller 3271, customer 906, locations 201, catalog 113, me 71, webhooks 75, registration 205;
plugins 659.

**Shared schemas** (all `import { t } from "elysia"`): 257 ext usages. `lib/schemas/entities.ts` 175 (1393 lines),
`composed.ts` 44, `discount.ts` 17, `holidays.ts` 11, `dashboard.ts` 5, `stock.ts` 3, `lib/pagination.ts` 2.
By kind across lib: 150 Nullable, 67 Date, 55 Integer, 1 File (in a comment). `lib/schemas/forms/*` are **pure
TypeBox** (`Type`) and shared with the seller FE (`@bibs/api/schemas`). No t.Numeric, ObjectString, ArrayString,
Form, Cookie or UnionEnum anywhere.

Special features per module:
- **me**: `POST /me/avatar` is multipart with `t.File({type:"image", maxSize:"5m"})` (byte sniffing); `DELETE /me/avatar`. Response `okRes({image})` / OkMessage.
- **locations**: `/municipalities/all` sets `cache-control` (prod `public, max-age=86400, stale-while-revalidate=604800`,
  else `no-store`, lines 115-118). `/municipalities` query is `t.Composite([PaginationQuery, …])`. `/geocode`:
  auth, then rateLimit; query `q` 3-200 chars, `limit` t.Integer 1-10 default 5 with a `title`, `lat`/`lng`
  t.Number (coerced); responses include 429 and 503.
- **catalog**: query-only GET listings (`CategoryListQuery`, etc.); public.
- **registration**: 4 POSTs with rate limits; responses `withConflictErrors({200, 429})` (sign-in uses `withErrors`);
  409 subclasses with `resentAt`; `accept-invite` checks passwords → `ServiceError(400,"Le password non coincidono")`.
  `sign-in` returns the token in the body and **sets no cookie** (the FE logs in through native `/auth/api/sign-in/email`).
- **webhooks**: `parse: "none"` (`webhooks/routes/stripe.ts:47`), raw `await ctx.request.text()` (23). Missing
  `stripe-signature` → 400 `{error:"missing signature"}`; a message containing "signature" → 400 `{error:"invalid signature"}`;
  other failures → 500 `{error:"internal error"}`; ok → `{received:true}`. **Not the standard envelope.** No
  response schema. Scopes: platform, connect, thin.
- **customer**: query coercion heavy (`ProductSearchQuery`/`StoreSearchQuery`, `lib/queries.ts:79-170`: Number lat/lng/
  radius/minPrice/maxPrice, Boolean openNow/onSale, defaults). `t.Omit` for the facet routes. No uploads.
- **admin**: 4 CSV imports with `t.File()` **without** `type` (no sniffing): `body.file.text()` in category-imports
  and characteristic-imports. `PATCH /sellers/:id/{verify,reject}` take **`t.Date` as an input** (`expectedUpdatedAt`,
  `admin/routes/sellers.ts:23-26`, optimistic 409). Billing `PUT /billing/pricing` (validation tests in
  `tests/modules/admin-pricing-validation.test.ts`). The `/admin/requests/` trailing slash is noted in 1.1.
- **seller**: uploads `t.Files({type:"image",maxSize:"5m"})` + `position` t.Integer as a multipart string
  (images, store-images); `t.File({type:"image"})` without maxSize (onboarding document, settings
  document change as `t.Optional`); **`POST /products/import` with `t.File({type:"text/csv"})`: Elysia sniffs CSV
  with file-type, which cannot detect text, so a real CSV always gets 422 "File: tipo di file non ammesso"
  (observed in an Elysia 1.4.30 probe). The endpoint is broken today and no FE uses it.** Discount bodies take
  `t.Date` inputs (`lib/schemas/discount.ts:50-64`). Products query has `productCategoryIds: t.Array(t.String())`
  (ArrayQuery) and `inStock` t.Boolean (`seller/routes/products.ts:107-130`). `GET /products/lookup` returns
  `okRes(t.Union([EanLookupResultSchema, t.Null()]))` (190). The `/stores` cancel response carries
  `status: t.Union([Literal canceling, canceled])` (318). Settings index route `/settings/`. No redirects:
  Stripe portal and checkout return URLs in JSON.

Across all modules: no redirects, no cookies set by our routes (only better-auth's mount sets them), no
streaming/SSE/generators, no `status()` helper in routes. `set.status` appears only in webhooks (3), `/ready`
(1) and the rate limiter. Custom headers come only from cache-control (1), retry-after (rate limit) and x-request-id.
Response maps always use status keys from {200, 400, 401, 403, 404, 409, 422, 429, 500, 503}, every one with the
`{success:false,error:<literal>,message}` schema (`lib/schemas/responses.ts:39-106`).

---

## 5. Elysia imports outside routes
- **Services: 0 of 75 import elysia.** 4 import `@sinclair/typebox` (that is the "71/75 agnostic" figure):
  `admin/services/requests.ts` (Static), `admin/services/sellers.ts` (Static + **runtime TypeCompiler** on stored
  JSON), `seller/services/checkout.ts` (Static), `seller/services/stores.ts` (Static). These depend on TypeBox, not on the framework.
- **Transitive elysia load from services**: about 16 services import `parsePagination` (a pure function) from
  `lib/pagination.ts`, a file that also builds `PaginationQuery` with Elysia's `t`. `admin/services/stores.ts`
  imports a type from `lib/queries.ts`.
- lib files that import elysia (10): `lib/pagination.ts:1` (t), `lib/queries.ts:1` (t),
  `lib/validation-message.ts:2` (type `ValidationError`), `lib/schemas/{responses,entities,composed,discount,holidays,dashboard,stock}.ts` (t).
- plugins: all 7 (`rate-limit.ts` only `import type { HTTPHeaders }`).
- `src/types/logixlysia.d.ts` augments `elysia`'s `SingletonBase.store`.

---

## 6. Tests
Counts (static `it(`/`test(` declarations; loop-generated cases count once):
| dir | files | tests |
|---|---|---|
| tests/unit | 19 | 83 |
| tests/lib | 27 | 253 |
| tests/modules | 15 | 93 |
| tests/plugins | 4 | 38 |
| tests/integration | 101 | 940 |

**26 files call `.handle()`** (213 declared tests in them): integration 7 (`admin-requests`, `customer-checkout`,
`locations-geocode-route`, `seller-dashboard`, `seller-orders-routes`, `seller-store-order-types-routes`,
`seller-store-reservation-hours`), lib 2 (`logger`, `validation-message`), modules 13 (`admin-pricing-validation`,
`integer-inputs`, `registration-response-schema`, `registration`, `seller-{billing,checkout,closures,discounts,employees,settings,stores}-owner-only`,
`store-update-validation`, `stripe-webhook-route`), plugins 4 (all of them). 24 of the 26 import `Elysia`;
`stripe-webhook-route` calls `stripeWebhookRoutes.handle` directly and `locations-geocode-route` dynamically imports Elysia.

How the test app is built (**no shared helper; the pattern is copy-pasted in about 20 files**):
`new Elysia().state("pino", noopPino).use(errorHandler)[.use(requestId)].use(<routePlugin>)`. Route plugins are
mounted **bare, without module prefix or guard** (e.g. `/billing/summary`, not `/seller/billing/summary`);
`admin-requests` wraps with `new Elysia({prefix:"/admin"})`.
- Fake auth: `.resolve(async ({request}) => { user from header "x-test-user" (DB lookup); return {user, ...await resolveSellerAccess(u)} })`
  in the seller integration tests (orders-routes, dashboard, order-types-routes, reservation-hours) and in
  customer-checkout (customerProfile). The owner-only tests use **no** resolve, so `isOwner` is undefined and
  `requireOwner` → 403 (their bodies are valid on purpose, so a 422 would not mask it).
- Real better-auth only in `locations-geocode-route` (real `locationsModule`, asserts 401 without a session) and
  in service-level tests (`auth-email-password`, `registration-accept-invite`: `auth.api.*`, dynamic import after
  `mock.module("@/db")`).
- DB: testcontainers PostGIS through `tests/helpers/test-db.ts` (`setupTestContainer`, `getTestDb`) +
  `mock.module("@/db", Proxy→getTestDb())`; `helpers/fixtures.ts` (618 lines, `createTest*`); `helpers/cleanup.ts`
  `truncateAll`. Preload `tests/preload.ts` sets fake env. Integration runs `--parallel=4 --isolate`.
- Tests that exercise plugins directly: `plugins/error-handler.test.ts` (26: ServiceError, pg codes, APIError,
  422 Italian, response → 500, file type, 404, envelope, x-request-id on errors, real logixlysia),
  `plugins/rate-limit.test.ts` (7, Elysia + fake server), `plugins/request-id.test.ts` (3),
  `plugins/normalize.test.ts` (2, trim only), `unit/rate-limit.test.ts` (consume, pure),
  `unit/cors-origin.test.ts` (pure), `unit/auth-error-mapping.test.ts` (pure), `lib/logger.test.ts` (3, real
  logixlysia), `lib/validation-message.test.ts` (21, through a real Elysia ValidationError), `modules/integer-inputs.test.ts`
  (fractions → 422 and Italian messages on real routes, including multipart). `modules/registration.test.ts` (22)
  covers rate limit, request-id and the error handler through the registration plugin.
- The other ~94 integration files test services directly and are framework-agnostic.

---

## 7. Coupling hotspots for the strangler (`elysia.mount(prefix, hono.fetch)`)

Facts about `mount` (verified in `elysia/dist/index.mjs:1426-1470` and probes):
- It registers `ALL <p>` and `ALL <p>/*` with `parse:"none"` (raw body intact, so the Stripe signature is safe) and
  `detail.hide` (**the module vanishes from `/openapi`**). It **strips the prefix**: Hono sees `/avatar`, not
  `/me/avatar`. The strip length uses the *mounting instance's* prefix, so always mount on the root app.
- Global Elysia hooks still wrap the mount: CORS headers, `x-request-id` (merged into Hono's Response), the XFF
  overwrite (Hono can read `x-forwarded-for` as the trusted socket IP), logixlysia. Elysia's `onError` does
  **not** see Hono errors, so Hono needs its own envelope/onError from day 1.
- Under the mount, Hono's `fetch(req)` gets **no Bun `server`**, so `getConnInfo`/`requestIP` are unavailable.
  `clientIp()` would collapse to `"unknown"` and all clients would share one bucket (registration, geocode)
  unless the Hono side keys on the overwritten XFF.
- Mount points: me `/me`, locations `/locations`, customer `/customer`, seller `/seller`, admin `/admin`,
  registration `/register`, webhooks `/webhooks`. **catalog has no prefix**: 4 root paths, i.e. 4 mounts.
  health is root.

Files every module PR touches:
1. `src/index.ts`: swap `.use(xModule)` for `.mount("/x", honoX.fetch)`; `export type App` shrinks, so the FEs
   typecheck against the remaining Elysia surface.
2. `src/types.ts` + `package.json` exports: add a Hono `AppType` for `hc`.
3. `lib/schemas/{entities,composed,responses,discount,holidays,dashboard,stock}.ts`, `lib/queries.ts`,
   `lib/pagination.ts` use Elysia `t` and are shared across modules (entities.ts alone 1393 lines). A per-module
   rewrite collides with every other module. Cheapest path: keep them as-is during the strangler. Elysia's
   `t.*` are plain TypeBox 0.34 Transform/Union schemas plus Elysia formats and Kinds, so a TypeBox-0.34 validator
   on the Hono side (Default → Clean → Convert → Check → Decode) can reuse them while Elysia is still imported.
   A TypeBox 1.x `@hono/typebox-validator` cannot reuse them without a rewrite.
4. `plugins/error-handler.ts`: the mapping (APIError/ServiceError/pg/validation/404/500) must be extracted into a
   framework-neutral `toErrorResponse(err)` shared by Elysia `onError` and Hono `app.onError`/`notFound`.
5. `lib/validation-message.ts`: typed on Elysia `ValidationError` (uses only `customError`, `valueError`, `type`);
   needs an adapter from the Hono validator's first TypeBox error. `lib/validation-rule.ts` is pinned to the
   TypeBox 0.34 `ValueErrorType` and shared with the seller FE.
6. `plugins/better-auth.ts`: the `auth` macro becomes a Hono middleware; the XFF overwrite stays global in Elysia
   until cutover, then becomes Hono root middleware (needs `server.requestIP` from `Bun.serve` env).
7. `plugins/rate-limit.ts`: `rateLimit` is shaped for the Elysia ctx (`set`, `server`, `store`); `consume` and
   `clientIp` are pure.
8. `lib/logger.ts#getLogger(store)` (69 route call sites pass Elysia `store`); on Hono, use the standalone `logger` or `c.var`.
9. `modules/*/context.ts` `with*` casts (~130 sites) and the inline customer/admin resolves in `index.ts`.
10. Tests: 26 `.handle()` files and the ~20 copy-pasted harnesses (`noopPino` + `errorHandler` + `x-test-user` resolve).
    A shared Hono test helper is worth writing once.
11. FE: `packages/ui/src/lib/api-client.ts` (Eden `treaty<App>`, `parseDate`, `edenMessage` reads `{value}`),
    `apps/{admin,seller,customer}/src/lib/api.ts`. `api()` call sites: about 35 admin, 62 seller, 27 customer
    (by `api().` regex; the decision record says 164 calls in 72 files with all patterns).
12. `/openapi`: mounted modules disappear from Elysia's spec until the Hono spec is merged into `documentation.paths`.
13. Elysia-only behaviours to reproduce per module (none of them have module-specific tests except where noted):
    unknown-field stripping on body/query/response; query coercion/defaults/arrays; JSON `"3"` → 3 for t.Integer;
    `t.Date` input decoding; magic-byte file sniffing; trailing-slash tolerance; 422 before 401/403; HEAD; 404
    envelope; formats registry; trimming except password keys.
