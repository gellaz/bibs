# Probe: Elysia .mount + Hono + better-auth (2026-10-25)

> Copiata dallo scratchpad della sessione di pianificazione il 2026-10-25, senza tagli. I percorsi `scratchpad/hono/...` citati qui ora stanno in questa cartella: vedi la sezione «Note e prototipi» di [`../../2026-10-25-hono-migration.md`](../../2026-10-25-hono-migration.md#note-e-prototipi).

Versions: elysia 1.4.30, hono 4.13.14 (temporary `bun add` in the worktree), better-auth 1.7.12, bun 1.4.4.
Prototypes: `probe-mount/hono-auth.ts` (middleware), `probe-mount/mount.test.ts` (24 tests, all green,
real app chain from src/index.ts minus cron/listen/ensureBucket, testcontainer DB, real better-auth sessions),
`probe-mount/overlap.test.ts`. Run: copy into `apps/api/tests/probe/`, `bun add hono@4.13.14` in apps/api,
`cd apps/api && bun test tests/probe/mount.test.ts --timeout 180000`. `bun run typecheck` green with them.

## 1. Mount semantics (Elysia 1.4.30 `mount(path, fn)`, dist/index.mjs:1426)

- Prefix is **stripped**: `replaceUrlPath(url, path.slice((prefix+path).length) || "/")`. Hono sees `/echo`
  for `/zz-probe/echo`, `/` for `/zz-probe`; host and query kept. (`mount("/", fn)` would NOT strip.)
- Registers `ALL path` and `ALL path/*`, `parse: "none"`, `detail.hide: true`.
- So a migrated module is a Hono app with **relative** routes (`/avatar`), mounted at `/me`; at the end
  `root.route("/me", meApp)` keeps the same tree and `hc<MeApp>(API + "/me")` keeps working.
- Precedence: an Elysia static route beats the mount wildcard whatever the order (`/me/avatar` → Elysia,
  `/me/other` → Hono). Partial migration of a module works; delete the Elysia route in the same PR.

| Behavior | Applies to mounted route? | What the Hono side must do |
|---|---|---|
| CORS preflight (OPTIONS) | YES: @elysiajs/cors answers in onRequest, 204 + allow-origin/max-age, before routing | nothing until the root swap; then `hono/cors` with same origin fn/methods/headers/maxAge |
| CORS response headers | YES: merged into the Hono Response (allow-origin, credentials, expose incl. X-Request-Id) | same as above |
| X-Request-Id | YES on the response (generated UUID or valid inbound echoed); Hono has no `requestId` ctx var | while mounted: read header if needed. End state: port the derive (NOT `hono/request-id`: it allows `[\w-=]{≤255}`, ours `[A-Za-z0-9._:-]{1,128}` → `edge-abc_123.4` would be replaced) |
| logixlysia request log | YES, with Hono's real status (201/404/500) | nothing; in Hono handlers `getLogger(undefined)` falls back to the standalone pino |
| errorHandler, ServiceError thrown in Hono | NO by default: Hono onError → `500 text/plain "Internal Server Error"` | strangler: `sub.onError(err => { throw err })` → Elysia errorHandler gives identical envelope + log (verified 403/500). End state: Hono root onError with the same mapping (extract errorHandler body into a framework-free `toErrorResponse(err)` used by both) |
| 404 inside the prefix | NO: Hono notFound → `404 text/plain "404 Not Found"` | `sub.notFound(() => { throw new NotFoundError() })` (strangler, identical body + "Route not found" log) or `c.json(errorBody("NOT_FOUND","Risorsa non trovata"),404)`. Unknown method under prefix → Hono 404 (Elysia also 404) |
| normalize plugin (deepTrim onTransform) | NO effect: hook runs but body is undefined (`parse: none`) — `"  x  "` reaches Hono untrimmed | replicate in the Hono validator layer (deepTrim except /password/i keys) BEFORE schema validation |
| Elysia schema normalize (strip extra fields) + 422 Italian | N/A (no schema on mount) | the main trap: validator must strip unknown fields in & out and map errors via `validationMessage` → 422 envelope |
| rate-limit (plugins/rate-limit.ts) | NO: per-route beforeHandle on /register/* only | port as middleware only where used (registration module) |
| x-forwarded-for overwrite (betterAuth onRequest) | YES: real socket test, Hono sees `::1`, x-real-ip removed | nothing while mounted; end state: global middleware `socketIpAsForwardedFor` (prototype) |
| auth macro / role guards | NO (mount is outside any guard) | `requireAuth` + `requireAdmin/requireSellerRole/requireSeller/requireCustomer` (prototype, bodies identical) |
| locale cookie | n/a: the API reads no locale cookie (grep: no cookie/locale handling in src); 422/ServiceError always Italian | nothing |
| global onRequest/onTransform/derive/resolve/onBeforeHandle/onAfterHandle/mapResponse/onAfterResponse | ALL fire (onAfterHandle gets a `Response` instance) | none; app has no custom ones besides plugins. WARNING: a global `onParse` turns mounted POSTs into Elysia 400 "Bad Request" — never add one during the strangler |
| Cookies/status/headers set by Hono | preserved: 201, custom header, 2 separate Set-Cookie (`getSetCookie()` length 2) | nothing |
| /openapi | mounted routes are HIDDEN (`detail.hide`) → the module's paths vanish from /openapi/json | gap to decide: generate Hono OpenAPI per module and merge into Elysia `documentation.paths`, or accept the gap until the root swap |

## 2. Request body

`parse: "none"`: Elysia never reads the body of a mounted route (`c.req.raw.bodyUsed === false` on entry).
JSON: identical, untrimmed. Multipart: file bytes/name/type identical, text fields untrimmed. Raw text:
byte-identical (`'{ "id":"evt_1",\n  "type" : "x" }'`) → Stripe webhooks can move with `await c.req.text()`.

## 3. better-auth middleware

Today: `auth: true` macro resolve = `auth.api.getSession({ headers })`, null → `ServiceError(401,"Devi accedere per continuare")`;
guards: admin role → 403 "Accesso riservato agli amministratori"; seller profile/onboarding → role 403
"Accesso riservato ai venditori"; other seller → `resolveSellerAccess(user)`; customer → customerProfile row
or 403 "Profilo cliente non trovato". Prototype `hono-auth.ts` (`createMiddleware<AuthEnv>`, `AuthEnv.Variables
= { user: auth.$Infer.Session.user; session: ... }`, typed `c.var.user.role`, `c.var.seller`, `c.var.customerProfile`).
Verified with real sign-in via `/auth/api/sign-in/email`: 401/403×4 bodies and statuses `toEqual` the Elysia ones,
200 for the right role; same through a standalone Hono app with its own onError (no Elysia).

Deviation found: **Elysia validates query/body BEFORE the auth resolve**: no cookie + missing `storeId` on
`/seller/dashboard` → 422 "Negozio: campo obbligatorio", not 401. Hono `use(requireAuth)` before the validator
gives 401. Recommend: accept and document (don't leak validation to anonymous callers); parity snapshots must
send valid input for auth cases.

Note: OpenAPI advertises `bearerAuth`, but `Authorization: Bearer <token>` is 401 today (no bearer plugin) and
in Hono too — parity holds, doc is misleading (out of scope).

## 4. better-auth handler

`src/plugins/better-auth.ts`: `.onRequest` overwrites x-forwarded-for with `server.requestIP(request)` and
deletes x-real-ip (defineProperty on request.headers), then `.mount("/auth", auth.handler)`; `lib/auth.ts`
`basePath: "/api"`, `ipAddressHeaders: ["x-forwarded-for"]`, URL fix-up `/auth${pathname}` in emails.
Hono twin (verified on a real Bun.serve socket):

```ts
root.use(socketIpAsForwardedFor)            // global, like today's onRequest; c.env = Bun server
root.all("/auth/*", mount(auth.handler))    // hono/mount strips "/auth" → basePath "/api" unchanged
```

`app.mount()` is deprecated in 4.13 (removed in v5): use `mount` from `hono/mount`. Do NOT switch to
`app.on(["GET","POST"], "/auth/api/*", c => auth.handler(c.req.raw))`: it would need basePath "/auth/api"
and touching the email URL fix-ups and `OpenAPI.getPaths`. Proof: rotating spoofed XFF → 5×200 then 429 on
`/request-password-reset`; negative control without the middleware → 7×200 on `/send-verification-email`.
Sign-in + get-session through the Hono mount work.

## 5. hc on a sub-tree

```ts
type MeApp = typeof meApp                                  // chained routes, relative paths
const api = hc<MeApp>(`${API_URL}/me`, { init: { credentials: "include" } })
const r = await api.whoami.$get(); if (r.ok) (await r.json()).data.role  // string | null
```

Works through the Elysia mount. Thrown ServiceErrors are not in hc's types (tsc rejected comparing a 401 body)
→ wrap once: `ApplyGlobalResponse<MeApp, { 401|403|422|500: { json: ErrorBody } }>` (exported by hono/client 4.13):
`if (r.status === 401) (await r.json()).message` typed. hc never revives dates (Eden `parseDate` default true
does) → FE code that receives `Date` from Eden gets strings; the FE typecheck will flag each site.

## Recommendations

1. Strangler recipe per module: Hono sub-app with relative routes + `onError(err => { throw err })` +
   `notFound(() => { throw new NotFoundError() })`, `.mount("/<prefix>", sub.fetch)` at the module's spot in
   index.ts, remove the Elysia module/routes in the same PR. CORS, X-Request-Id, logging, XFF stay free.
2. Ship a shared `src/hono/` kit first (with the `me/` spike): auth middlewares (prototype), validator wrapper
   doing deepTrim + strip-unknown + `validationMessage` 422, `ErrorBody` + `ApplyGlobalResponse` client type.
3. Decide the OpenAPI gap before the first module (merge per-module docs or accept a temporary hole).
4. Accept 401/403-before-422 as the one documented deviation.
5. Never add a global `onParse` while modules are mounted.
6. End state (root swap): hono/cors, custom request-id (our regex), `socketIpAsForwardedFor` global,
   `root.all("/auth/*", mount(auth.handler))`, onError from the extracted `toErrorResponse`.
