# Probe: validation + OpenAPI + Hono version (2026-10-25)

> Copiata dallo scratchpad della sessione di pianificazione il 2026-10-25, senza tagli. I percorsi `scratchpad/hono/...` citati qui ora stanno in questa cartella: vedi la sezione «Note e prototipi» di [`../../2026-10-25-hono-migration.md`](../../2026-10-25-hono-migration.md#note-e-prototipi).

Worktree `wf_b38f0299-889-4` (discarded afterwards). Prototypes in `probe-validation/prototype/`, outputs (JSON) in `probe-validation/`.
Method: "before" = real Elysia app (same `.use` chain as `src/index.ts`, minus logixlysia/cron/listen; test preload env, no DB: validation fails before any query, `auth` is a `resolve` so it runs after validation) driven with `app.handle`; "after" = Hono app with the same schemas driven with `app.request`; byte diff of `{status, body}`.

## 1. Versions and peers (npm, 2026-10-25)
| pkg | latest | other tags | hono peer | ok on 5.0.0-rc.1 (strict semver) |
|---|---|---|---|---|
| hono | 4.13.14 (2026-10-25) | next 5.0.0-rc.1 (2026-10-10) | – | – |
| @hono/typebox-validator | 1.1.0 | – | `>=3.9.0`, typebox `^1.0.30` | no (prerelease); yes at 5.0.0 GA |
| hono-openapi (rhinobase) | 1.5.0 | rc 0.5.0-rc.4 | `^4.11.2` | **no, also not at GA** |
| @hono/zod-openapi | 1.6.3 | – | `>=4.10.0`, zod ^4 | no (prerelease); yes at GA |
| @hono/zod-validator | 0.9.1 | – | `>=4.11.2` | same |
| @hono/standard-validator | 0.4.0 | – | `>=4.11.2` | same |
| @hono/cli | 0.1.11 (other tool) | next 1.0.0-rc.8 | dep `^4.9.12 \|\| ^5.0.0-0` | yes |
| @hono/bun | 1.0.1 | – | `>=4.13.9 \|\| ^5.0.0-0` | yes |
| typebox (1.x) | 1.4.3 (2026-10-22) | – | – | – |
| @sinclair/typebox | 0.34.52 (2026-07-11; catalog `^0.34.52`) | legacy-* | – | – |

Bun links every package to hono 5 rc without peer warnings (checked with semver 7.8.5: `peers.cjs`).
v5 changes (hono skill + docs/migrating-to-v5.md): ESM only, runtime adapters in `@hono/<runtime>`, `onError((c) => c.error)` (routable middleware), non-Error throws go to onError, `c.req.query()` values `string|undefined`, `c.req.json()` → `unknown`, `c.json(undefined)` throws, uniform wildcards, `app.mount` removed (use `hono/mount`). New and **experimental**: `defineHandler({param,query,json,form,response})` in `hono/factory` (request + response validation, Standard Schema or plain function per slot, response = single schema; v4 does not have it).

## 2. TypeBox 1 by changing the import
- Elysia-only builders used: `t.Nullable` 168, `t.Integer` 104 (Elysia override, not TypeBox's), `t.Date` 77, `t.File` 8, `t.Files` 2, `t.Composite` 6. **Not used**: Numeric, ObjectString, ArrayString, Form, BooleanString, MaybeEmpty, UnionEnum, Cookie. Builder calls: 1461 in lib, 695 in modules.
- Experiment: `cp -R src src-tb1`, rewrite only imports (`port-imports.ts`: 62 files, 51 `t` imports, 12 `@sinclair/typebox`→`typebox`, FormatRegistry→Format) + shim `lib/t.ts` (137 formatted lines). `tsc` on lib/schemas + queries + pagination + forms: **0 errors**; `static-check.ts` asserts StaticDecode/StaticEncode (Date→Date, wire string|number, File, Composite, Omit) — pass.
- What breaks without the shim: no `Type.Date/Nullable/Transform/Uint8Array`; `Composite` only as internal `Composite(left,right)` → `Evaluate(Intersect([...]))`; **unknown formats pass** in TB1 (0.34 rejected) and TB1's email/date/date-time differ from Elysia's on 10/32 samples (`formats-diff.ts`: TB1 email accepts `a@b`, `a@localhost`; TB1 date/date-time stricter) → re-register Elysia's functions + `integer`/`numeric`/`boolean`/`calendar-date` via `Format.Set`.
- Shim replacements (Elysia-identical JSON Schema, so /openapi and accept/reject stay the same): Integer = `Codec(Union[String{format:integer,default:0}, Integer(o)], o)` decode `+v` + re-check (throws → path-lost message, like Elysia); Date = `Codec(Union[date-time, date, Number])` → Date; Nullable = `Union([T, Null], {nullable:true})`; File = `Refine(Unsafe({x-file}), isFile)` (no `type`/`default` keywords: TB1 would check `type:"string"` on a Blob, and `Value.Default` would write "File" into a missing optional file); Files = Array of it.
- Other TB1 consumers: `modules/admin/services/sellers.ts` (Type.Composite + TypeCompiler → `Compile`), `lib/env.ts`, `lib/validation-rule.ts` (ValueErrorType → keyword), seller `typebox-errors.ts` (SetErrorFunction → `Locale.Set`, callback has no schema/value).
- **Mixing is impossible**: 0.34 `TypeCompiler.Compile` throws on a TB1 schema (`~kind` instead of the Kind symbol). Shared `lib/schemas` cannot flip while any Elysia route still uses them.

## 3. 422 parity
- 0.34 ValueError `{type: enum, path, schema, value}` vs TB1 `{keyword, instancePath, schemaPath, params}` (no schema/value; `required` is one error on the object with `requiredProperties`; union branch errors listed before the `anyOf` error).
- `firstError()` (TB1 port, `validation-rule.ts`): drop errors under an `anyOf` that failed, move `required` to the first missing key, resolve schema by `schemaPath`, value by pointer. First error equals 0.34's first in 4/4 ordering cases (`order-check.ts`). `validationMessage` body unchanged (diff: imports + param type, 10+/6-).
- `@hono/typebox-validator` as-is: `?page=2` → 400 `must be integer`, no defaults, codecs not decoded (`tbvalidator-check.ts`); its hook runs after Check, so it cannot fix coercion. Replaced by `v(target, schema)` on `hono/validator`.
- Result (27 real-app cases: registration, seller discounts body/query, customer products query, 404, malformed JSON, no Content-Type, text/plain, cookie `PARAGLIDE_LOCALE=en`): **27/27 byte-identical on hono 5.0.0-rc.1 and on 4.13.14**. Quirks reproduced: `?page=0` → "Valore non valido: deve essere almeno 1" (Elysia loses the label on decode), `?lat=abc` → "Latitudine: valore non valido", body `percent:"5"` accepted, malformed JSON → 500 (Hono throws HTTPException 400), missing Content-Type → "Richiesta non valida", 422 before 401 (auth must sit after the validators). API has no locale logic: 422 is Italian for every cookie.
- Same 27/27 with a **TypeBox 0.34** validator using Elysia's own `t` and the unchanged `validation-message.ts` (`after-034.ts`).

## 4. Coercion
Elysia (query/params, top-level only): Number→Numeric (`!!v && !isNaN(+v)`), Boolean→BooleanString (only "true"/"false"; "1" → 422), Integer via its own union; repeated key → last value; query strings NOT trimmed. `Value.Convert` is broader ("1"→true, "abc"... kept) → not used. Prototype: cached schema rewrite (Numeric/BooleanString codecs, ~25 lines) + last-wins for arrays.

## 5. normalize
Input: `Value.Default → Value.Clean → deepTrim (json/form, = plugins/normalize.ts) → Check → file magic bytes (file-type, today only Elysia's peer: add as dep) → Decode`. Output: `encode(schema, data)` = Clean → Encode (Date→ISO) → Check, off-schema → 500. Echo cases: 10/11 identical; the 11th differs only in the key order of the handler-internal query object. Nested extras (`passwordHash`, `nested.internal`, `list[].internal`, top-level `leak`) stripped as in Elysia.
- Hono has no response validation in v4; v5 `defineHandler({response: out(Schema)})` works with a function slot (prototype: same 422, response stripped/encoded) but is experimental, v5-only, single response schema, and with function validators hc types the json **input** as the decoded output (`startsAt: Date`). Helper `send(c, Schema, data)` works on v4 and v5 and types hc from the schema. All 176 routes with `response` have a single 200 success schema (`withErrors`), so one schema per route is enough.

## 6. /openapi
- Current `/openapi/json` is **non-deterministic**: Elysia writes `additionalProperties:false` into schema objects when it lazily compiles a route's validator, so the spec depends on which routes were hit since boot (`openapi-before.json` after 27 requests vs `openapi-cold.json`). Baseline = cold spec.
- In-repo generator (`openapi-gen.ts`, port of @elysiajs/openapi 1.4.16 `toOpenAPISchema` + `enumToOpenApi` + `nullToOpenApi` 3.1 branch, MIT; ~200 formatted lines), input = plain route list: **181/181 operations identical** (key-order-insensitive) to the cold spec over all non-/auth routes, both with TB1 schemas (`probe-openapi.ts`) and with the current 0.34 schemas (`openapi-034.ts`). Metadata from Hono itself: `app.routes` lists every middleware of a chain; `v()` and a no-op `doc({detail, response})` middleware carry the schemas (`probe-hono-routes.ts`: identical). Still to port: document assembly (info, tags, better-auth components/paths, from index.ts) and the Scalar HTML page.
- hono-openapi 1.5.0: TB1 needs a hand-written Standard Schema wrapper (TB1 1.4.3 has no `~standard`; standard-json's typebox adapter reads `.Type()`), `describeRoute` per route, and output differs on every op in parameters (description moved, no `required:false`), requestBody (json only vs Elysia's 3 content types) and responses; peer excludes v5.

## 7. hc
`v()` declares `in: StaticEncode<T>`, `out: StaticDecode<T>`. tsc assertions (`probe-client.ts`) pass on v4 and v5: json typed by wire type (`startsAt: string|number`, missing/mistyped fields rejected), query typed (`openNow: boolean`, `lat: number`; hc stringifies), param typed, response typed from schema via `send()` (`createdAt: string|number`, `passwordHash` absent). Date fields arrive as strings (Eden revived them; FE already treats them as `Date | string`, memory note). Error bodies thrown to onError are untyped in hc; FE narrows them at runtime (`edenMessage`/`unwrap`, 9 files) — an `hc` equivalent of `unwrap` is needed. tsc for prototype + client: ~3 s (not representative of 179 endpoints: that is the `me/` spike).

## 8. Zod cost
Not import-only: 2156 builder calls to rewrite (Optional/Nullable/Composite/Omit/Union-of-literals have different shapes), formats differ from Elysia's (parity drift on email), 42 `error:` messages + titles to move to `{error}`/`.meta`, validation-rule port to Zod issue codes, coerced query errors keep the path (Elysia's path-lost messages need a hack), `z.toJSONSchema` output ≠ Elysia's (no zero-diff without a translation layer; @hono/zod-openapi means `createRoute` for 181 ops), seller resolver/typebox-errors rewrite.
Where TB1 is worse than Zod: no Standard Schema (`~standard`) in 1.4.3 → no drop-in for @hono/standard-validator, hono-openapi, `defineHandler` schema slots, `@hookform/resolvers/standard-schema`; `@hookform/resolvers/typebox` (5.9.2) imports `@sinclair/typebox/compiler` → TB1 needs a custom ~25-line resolver (not prototyped). Zod is already used by 30 FE files. None of the parity criteria (422 bytes, coercion, normalize, /openapi, hc types) fails with TypeBox; Zod fails the /openapi and path-lost parity without extra layers.

## Recommendations
- **Hono version**: start on **4.13.x**, bump to 5.0 at GA. Evidence: the prototype is identical on both (27/27, 10/11, hc tsc) except `onError` signature; nothing needed is v5-only (`defineHandler` is experimental and mistypes function-validator input); on rc.1 strict semver rejects 5 of the 7 packages checked (4 only because 5.0.0-rc.1 is a prerelease; hono-openapi `^4.11.2` excludes v5 even at GA).
- **Validator**: own `v(target, schema)` on `hono/validator` (`validate.ts`, ~240 formatted lines incl. coercion, file check, response encode, error classes), not @hono/typebox-validator. During the strangler build it on **@sinclair/typebox 0.34 + Elysia's `t`** (27/27, no schema churn, seller untouched); flip to TypeBox 1 in one PR after the last Elysia module (import-only on 62 files + shim + validation-rule port + sellers.ts + seller resolver), proven 27/27 + tsc here. Reason: TB1 schemas cannot be consumed by Elysia, and lib/schemas are shared.
- **OpenAPI**: in-repo generator from `app.routes` metadata (181/181 vs cold spec, works on 0.34 and TB1 schemas). Not hono-openapi.
- **Response normalize**: `send(c, Schema, data)` = Clean → Encode → Check, 500 off-schema; works on v4/v5 and gives hc types. `defineHandler({response})` only if v5 GA keeps it.
- **Coercion**: Elysia-exact schema rewrite (Numeric/BooleanString, top-level, last-wins) in the query/param validator; not `Value.Convert`.

Not checked: multipart routes end to end (File magic bytes path only typed, not run); seller TB1 resolver; hc typecheck time on the full API; the Scalar page; `t.Integer` string leniency inside multipart numbers other than Integer.
