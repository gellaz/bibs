# Hono CLI on the API

## Since U11 (2026-10-26): the root app is Hono

`apps/api/src/app.ts` exports the root Hono app (named `app` and, for the CLI, as the default export)
with no import side effects: server, cron and `ensureBucket()` live in `src/index.ts`. **The CLI runs
directly on `src/app.ts`** (since the U11 ship, 2026-10-26) with two externals:

- `-e bun`: `src/lib/s3.ts` imports `S3Client` from `bun`; the CLI bundles the entry with esbuild and
  imports the bundle from a `data:` URL, and only Bun (the CLI file run with `bun`) resolves that import
  there;
- `-e @bibs/emails`: the CLI's esbuild forces `jsxImportSource: "hono/jsx"`, which would compile the
  react-email templates for the wrong runtime; as an external the package is loaded by Bun as it is.

Same rules as before: run the CLI file with Bun from `apps/api` (`bunx hono` runs it on Node, where
`bun` does not resolve), with the env of `apps/api` (`.env`/`.env.local`, or `bun --env-file=<file>`),
infra up (`bun run infra:up`). `tools/hono-entry.ts` (a runtime re-export of the app) is gone: it was
only there because the CLI could not bundle `src/app.ts` without the two externals.

```bash
cd apps/api
# zsh does not split "$HONO" into words: use a function
hono() { bun node_modules/@hono/cli/dist/cli.js "$@"; }   # or: bun --env-file=<env> node_modules/...
APP="src/app.ts -e bun -e @bibs/emails"                    # in zsh: ${=APP}, or write it out
BASE=../../docs/superpowers/plans/2026-10-25-hono-migration/baseline

hono routes src/app.ts -e bun -e @bibs/emails             # 207 rows: 183 routes + @ERROR/@NOT_FOUND of the root and the 11 sub-apps
hono request /health src/app.ts -e bun -e @bibs/emails    # one request, in process

# every baseline batch file (bodies captured before each module moved) — each must print failed: 0
for f in $BASE/hono-batch-*.jsonl; do
  echo "$(basename $f) $(hono batch $f src/app.ts -e bun -e @bibs/emails --compact 2>/dev/null | grep -o '{"ok".*' | tail -1 | jq -c .data.summary)"
done
grep '"expect"' $BASE/hono-snapshot.jsonl > /tmp/hono-expect.jsonl
hono batch /tmp/hono-expect.jsonl src/app.ts -e bun -e @bibs/emails --compact 2>/dev/null | grep -o '{"ok".*' | tail -1 | jq -e '.data.summary.failed == 0'

# snapshot diff: compare as sorted sets (the route order follows src/app.ts, not the old table)
hono snapshot --status-only src/app.ts -e bun -e @bibs/emails 2>/dev/null | grep '^{"\(path\|method\)"' | sort > /tmp/hono-snapshot.sorted
sort $BASE/hono-snapshot.jsonl | diff - /tmp/hono-snapshot.sorted
```

`grep -o '{"ok".*' | tail -1` and not `grep '^{"ok"'`: a step whose error is logged with a stack (the
webhook signature steps) prints the bundle's `data:` URL into the output, and the summary can end up
on the same line.

U11 results (2026-10-26, `@hono/cli` 1.0.0-rc.8, env with the compose defaults of `compose.yml` and a
placeholder `STRIPE_WEBHOOK_SECRET`): every batch file passes on the base commit (`c4d4ba5b`, old
entry) and on U11 — admin-1 171/171, admin-2 135/135, customer 140/140, locations 35/35, me 18/18,
registration 31/31, seller-orders 204/204, seller-products 113/113, seller-stores 230/230,
webhooks 21/21 (without a webhook secret the 7 signature steps answer 500 on both sides), snapshot
expectations 66/66. Snapshot as sets: only the rows of the registered deltas (the dead
`/<module>/auth` copies and `ALL /auth`, `ALL /auth/*`, `OPTIONS /`, `OPTIONS /*`, the trailing
slash of `/seller/settings/` and `/admin/requests/`) and the dev-DB UUID lines.

U11 fix round 1 (2026-10-26, same env): the same numbers on every batch file and on the snapshot
expectations (1,164 steps, 0 failed), `routes` 207 rows, the snapshot as sets unchanged.

U11 ship (2026-10-26, same env): the same 1,164 steps, 0 failed, three ways — through the old
`tools/hono-entry.ts`, through a scratch entry that statically re-exported the app, and directly on
`src/app.ts` with the commands above; `routes` 207 rows; snapshot as sets (184 rows, 66 with `expect`)
unchanged.

**`hono diff` does not work for this repo, and cannot without a CLI change** (`hono diff --base
origin/feat/hono-migration`, tried again at the U11 ship: `SNAPSHOT_FAILED`). It takes neither an
entry file nor `-e`: it runs `hono snapshot` on the default entry (`src/index.ts`, `.tsx`, `.js`,
`.jsx`) in two temporary worktrees. Here `src/index.ts` is the server (cron, `ensureBucket()`,
`Bun.serve`), not a default-exported app, and without `-e` the bundle fails on `bun` and
`hono/jsx/jsx-runtime` (and, against a base before U11, on the old framework's packages, no longer
installed). Use the batch files and the sorted snapshot diff above.

## Until U11: the CLI on the old app

Tried on 2026-10-25 at `e4be2926` with `@hono/cli` 1.0.0-rc.8 (devDependency of `apps/api`) and
`hono` 4.13.14 installed **temporarily** with `bun add -d hono@4.13.14 --no-save` in `apps/api`
(`package.json` and `bun.lock` untouched; 4.13.14 is the copy `@hono/cli` already brings into the store).

**Result: it loads, but only with the CLI itself running on Bun.** Saved:
[`hono-snapshot.jsonl`](hono-snapshot.jsonl) — 198 lines, 66 with `expect` (status of every paramless
GET plus the 404 probe with its body), replayed with `batch`: 66/66 passed, and a second snapshot was
identical.

### How it loaded

Entry: `tools/hono-entry.ts` (deleted at the U11 ship, see above; in the git history). It took the real app from
[`../tools/load-app.ts`](../tools/load-app.ts) (no listen, no cron, `ensureBucket()` stubbed) and puts
it behind `new Hono()`: every Elysia route is registered on Hono with a handler that forwards the
untouched request to the same `app.fetch`, and a `hono/mount` middleware on `/*` stays as the fallback
(it was `.mount("/", app.fetch)` on Hono 4; `app.mount()` is gone in Hono 5). The answers
are Elysia's; the table is only there so the CLI can see the routes.

Run the CLI file with Bun, from `apps/api` (Bun loads `.env` and `.env.local` from the cwd). Since U1
`hono` (5.0.0-rc.1) is a dependency of `apps/api`; before U1 it had to be linked first with
`bun add -d hono@4.13.14 --no-save` and dropped afterwards with `rm node_modules/hono`:

```bash
cd apps/api
HONO="bun node_modules/@hono/cli/dist/cli.js"
ENTRY=../../docs/superpowers/plans/2026-10-25-hono-migration/tools/hono-entry.ts
$HONO routes $ENTRY                     # 197 routes: the Elysia table as Hono sees it
$HONO request /health $ENTRY            # one request, in process
```

### Parity net for each PR (until U11)

Needs `bun run infra:up` (requests hit the dev DB, GETs only, and `/ready` checks DB + S3) and the env
files. The app's pino logs share stdout with the CLI, hence the `grep`s. The CLI exits 0 even when steps
fail: the verdict is `summary.failed`.

```bash
cd apps/api
HONO="bun node_modules/@hono/cli/dist/cli.js"
ENTRY=../../docs/superpowers/plans/2026-10-25-hono-migration/tools/hono-entry.ts
BASE=../../docs/superpowers/plans/2026-10-25-hono-migration/baseline

# batch: replay the baseline expectations — must print true
grep '"expect"' $BASE/hono-snapshot.jsonl > /tmp/hono-expect.jsonl
$HONO batch /tmp/hono-expect.jsonl $ENTRY --compact 2>/dev/null \
  | grep '^{"ok"' | jq -e '.data.summary.failed == 0'

# diff: regenerate and compare with the committed snapshot (routes added/removed, statuses changed)
$HONO snapshot --status-only $ENTRY 2>/dev/null | grep '^{"\(path\|method\)"' > /tmp/hono-snapshot.jsonl
diff $BASE/hono-snapshot.jsonl /tmp/hono-snapshot.jsonl
```

Reading the results:

- A module moved to Hono and mounted in Elysia (`.mount('/me', meApp.fetch)`) sits behind `ALL /me/*`:
  its GETs drop out of the regenerated snapshot (expected diff), while the `batch` replay still calls
  every baseline path through the mount. `batch` is the check that matters; also pass the sub-app to
  `route-inventory.ts --hono` so the route list stays complete.
- `--status-only` checks statuses, not bodies (only the 404 probe keeps its body). For the module of
  the PR, add batch lines with `expect.body` captured before the change (`$HONO request <path> $ENTRY`):
  401/422/404 envelopes in Italian, CORS and `x-request-id` headers, and the non-GET routes, which the
  snapshot lists without `expect`. A login step (`POST /auth/api/sign-in/email` with a test user) carries
  its cookie to the next steps.
- The three param lines (`/customer/products/<uuid>`, `/customer/stores/<uuid>`,
  `/customer/stores/<uuid>/products`) use an id found in a dev DB response: after a reseed they change.
  The same goes for `/seller/orders/pickup/IT`: `IT` is the first country `code` of
  `/locations/countries`. Since U2 that route sits behind the `/locations` mount, the snapshot no
  longer sees its answer and writes `/seller/orders/pickup/:code` without `expect` (the `batch`
  replay of the baseline line still checks the 422).
- Module batch files with bodies, captured on the commit before each module moved:
  `hono-batch-me.jsonl` (U1), `hono-batch-locations.jsonl` and `hono-batch-registration.jsonl`
  (U2+U4), `hono-batch-customer.jsonl` (U3), `hono-batch-seller-products.jsonl` (U5),
  `hono-batch-seller-stores.jsonl` (U6), `hono-batch-seller-orders.jsonl` (U7),
  `hono-batch-admin-1.jsonl` (U8),
  `hono-batch-admin-2.jsonl` (U9), `hono-batch-webhooks.jsonl` (U10).
  The registration file logs in with `customer1@test.com` through `/register/sign-in` and
  expects a 409 `EMAIL_PENDING_VERIFICATION` for `collaudo.hono.u4@test.com`, a customer created once
  by a registration on the dev DB and left unverified (each replay re-sends its link to Mailpit).
  The 409 holds for 7 days from that user's creation (2026-10-25): after that the API deletes the
  stale account and registers it again (200, the step fails). Before replaying later, check the user
  or drop that line; never point it at a seed user.
  `hono-batch-seller-orders.jsonl` (U7, 204 steps: orders,
  discounts, store checkout, billing; logins of `customer1@test.com`, `seller96@test.com`,
  `seller@dev.bibs`, `employee1@test.com`; only reads and answers that come before any write). The dev
  DB is shared: the browser checks of other units create and cancel orders on Bottega Dev, so the U7
  order lists filter on statuses those checks never produce (`ready_for_pickup`, `completed`,
  `expired`, `shipped`) and the counts use stores or types without such orders. Date-bound lines: the
  promotion «Settimana della pasta» ends on 2026-10-29 08:46 UTC, after which `/seller/discounts`
  (assignable vs concluded) answers differently; the reservations of the seed expire on 2026-11-23.
  To capture a batch on the base commit without a checkout, export the base tree with
  `git archive <sha> | tar -x -C <dir>`, symlink `node_modules` (root, `apps/api`, `packages/*`) from a
  worktree and run the CLI from `<dir>/apps/api`.
  `hono-batch-admin-2.jsonl` (U9, captured on `a2a7e044`) reads the dev DB as it was on 2026-10-26:
  seller and store counts, the first rows of the lists and the decided VAT change
  `c1392aa5-…` (its approve/reject answer 400 «non più in attesa» without writing). Its two 409 steps
  send a stale `expectedUpdatedAt` to a pending (`seller146@test.com`) and an active seller: the
  compare-and-set UPDATE matches no row, so nothing is written. A new seller, store or subscription
  in the dev DB shifts counts and first rows: replay it on the base commit too before reading a
  failure as a regression.
- `hono-batch-seller-products.jsonl` (U5) and `hono-batch-seller-stores.jsonl` (U6) log in with
  seed users and expect full bodies of dev-DB data: a test entity created by another unit's
  browser check moves them (on 2026-10-26 a product «Collaudo Hono U3» in `seller@dev.bibs`'s
  store made 7/113 seller-products steps fail, on list lengths and totals only; 113/113 again once it was deleted). The U6 file keeps
  only the clock-free part of the bodies (no `openStatus` of the stores, no `expiresAt` of the
  reservation preview, no holiday `nextDate`, only `success` for the dashboard) and signs out
  (`POST /auth/api/sign-out`) after each user, so a replay leaves no session behind. Its last 10
  lines come from U6's review round 1, captured on `e85d6094`: invitations to emails that only bare
  Elysia accepts (`a@b.c`, …) and a 501-UTF-16-unit `websiteUrl`, anonymous and as
  `employee1@test.com`: all 422, so nothing reaches a handler even on a regression.
- Trap the snapshot already shows: unauthenticated GETs with a missing required query answer **422
  before 401** (`/seller/orders`, `/seller/orders/counts`, `/seller/dashboard`,
  `/seller/products/status-counts`, ...): Elysia validates the query before the `auth` macro resolves.
  A Hono port that puts auth middleware first turns them into 401.
- Speed: a snapshot takes ~31 s wall (1.3 s CPU; the rest is the process waiting on open handles).

### What does not work, and why

| Attempt | Result |
|---|---|
| `bunx hono routes src/index.ts` | Build fails: `Could not resolve "bun"` (`src/lib/s3.ts` imports `S3Client` from `bun`) and 12 × `Could not resolve "hono/jsx/jsx-runtime"`: the CLI's esbuild forces `jsxImportSource: "hono/jsx"`, so the react-email `.tsx` of `@bibs/emails` would be compiled for the wrong JSX runtime even with hono installed. |
| same with `-e bun -e sharp -e @bibs/emails` | Builds, then Node fails: `Failed to resolve module specifier "bun"` (the bundle is imported from a `data:` URL). |
| `bunx hono routes\|snapshot\|batch tools/hono-entry.ts` | `Bun is not defined`: `bunx` runs the CLI's `#!/usr/bin/env node` bin on **Node**, and `routes`, `snapshot`, `batch`, `browse` import the app in the CLI process. |
| `bunx hono batch - … --runtime bun` | `Unknown runtime: bun`: `batch` and `snapshot` take only `node \| workerd \| vite`. |
| `bunx hono request /health tools/hono-entry.ts --runtime bun` | **Works** (CLI on Node, app piped to `bun run -`), one process per request. |
| `bunx --bun hono routes tools/hono-entry.ts` | CLI on Bun, but `.env` is not loaded: `Missing or invalid env vars`. Running the file with `bun …/cli.js` from `apps/api` loads it. |
| `new Hono().mount("/", app.fetch)` alone | Loads, but the mount is one opaque `ALL /*` (a middleware for `inspectRoutes`): `routes` is empty and `snapshot` only records the 404 probe. Hence the forwarding table in `hono-entry.ts`. |
| `hono diff` | Not usable until the cutover. It takes no file: it runs `hono snapshot` on the default `src/index.ts` in two temporary git worktrees, and that file is the Elysia app — not a default export, Bun-only imports, and side effects on import (`ensureBucket()`, `listen(3000)`, cron jobs). The regenerate-and-`diff` step above replaces it. |

`src/index.ts` exports only `type App`, not the instance: `load-app.ts` captures the app by stubbing the
Bun adapter's `listen` (Elysia's `listen` is an instance field, so `Elysia.prototype` cannot be patched).

### Before relying on the CLI's own entry (cutover)

Making `src/index.ts` a Hono default export is not enough for `bunx hono … ` without `hono-entry.ts`
or for `hono diff`. What still blocks, as of this baseline:

- import-time side effects in the entry (`ensureBucket()`, the server start, cron) must move out of
  the module that builds the app;
- the CLI bundles the entry with esbuild and imports it from a `data:` URL: `import … from "bun"`
  (`src/lib/s3.ts`) cannot resolve there, and a bare external cannot resolve from a `data:` URL on Node;
- the forced `jsxImportSource: "hono/jsx"` would compile `@bibs/emails`' react-email templates for the
  wrong runtime;
- `hono diff` copies only `.env` and `.dev.vars` into its temporary worktrees, not `.env.local`.

Until then, keep `hono-entry.ts` (it loads `src/` at runtime through Bun, outside the CLI's bundle) and the
regenerate-and-`diff` step.
