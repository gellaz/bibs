# Typecheck baseline (Elysia + Eden)

Measured on 2026-10-25 at `e4be2926` (`feat/hono-migration` = `main`), before any Hono code.

- Machine: Apple M1, 8 cores, 16 GB; macOS (Darwin 25.6). Load average 4.5–5 during the runs
  (other sessions and Docker were active): treat differences under ~1 s as noise.
- TypeScript 6.0.3 (`node_modules/.bin/tsc`), Bun 1.4.4. Not incremental: no `tsBuildInfo`, so run 1 and
  run 2 do the same work.
- Command, from each workspace: `tsc --noEmit` (what `bun run typecheck` runs, after
  `paraglide:compile` in the frontends — compiled once beforehand and not timed).
  Wall time measured around the `tsc` process. All runs exited 0.

## Wall time

| Workspace | Run 1 | Run 2 | `--extendedDiagnostics` run |
|---|---:|---:|---:|
| api | 6.85 s | 6.45 s | 6.87 s |
| admin | 9.07 s | 9.95 s | 8.62 s |
| customer | 8.44 s | 8.78 s | 9.65 s |
| seller | 10.15 s | 9.77 s | 12.17 s |

## `--extendedDiagnostics`

| Workspace | Check time | Total time | Memory used | Files | Types | Instantiations |
|---|---:|---:|---:|---:|---:|---:|
| api | 4.87 s | 6.66 s | 980,452 K | 3,043 | 255,289 | 1,766,950 |
| admin | 6.05 s | 8.41 s | 1,351,296 K | 4,965 | 336,695 | 2,227,396 |
| customer | 7.15 s | 9.40 s | 1,210,178 K | 4,367 | 308,089 | 2,095,749 |
| seller | 8.63 s | 11.89 s | 1,491,205 K | 6,008 | 367,373 | 2,369,650 |

Parse / bind time: api 0.72 / 0.43 s, admin 0.85 / 0.44 s, customer 0.87 / 0.53 s, seller 1.24 / 0.52 s.

The frontends typecheck the API source through Eden (`@/*` also maps to `../api/src/*` in seller), so their
check time includes the Elysia route types. This is the number the `hc` spike on `me/` compares against.

## Rerun

```bash
for ws in api admin customer seller; do
  (cd apps/$ws && { [ $ws = api ] || bun run paraglide:compile >/dev/null; } \
    && time ../../node_modules/.bin/tsc --noEmit \
    && ../../node_modules/.bin/tsc --noEmit --extendedDiagnostics | grep -E '^(Check time|Total time|Memory used|Instantiations):')
done
```
