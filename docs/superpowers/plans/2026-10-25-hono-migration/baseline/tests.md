# Test baseline (Elysia + Eden)

Run on 2026-10-25 at `e4be2926` (`feat/hono-migration` = `main`), from the repo root, untouched tree:

```bash
bun run test   # emails → ui → api (unit, then integration) → admin → customer → seller, chained with &&
```

Root exit code **0**, wall time **350 s** (Apple M1, Bun 1.4.4, Docker up for the testcontainers;
load average ~4.5 from other sessions). Every workspace printed `Exited with code 0`; the chain is `&&`, so a
failure would have stopped the later workspaces: check that all six appear.

| Workspace | Runner | Files | Pass | Fail | Skip | Reported duration | Exit |
|---|---|---:|---:|---:|---:|---:|---:|
| `@bibs/emails` | bun test | 4 | 26 | 0 | 0 | 0.23 s | 0 |
| `@bibs/ui` | vitest | 8 | 37 | 0 | 0 | 2.58 s | 0 |
| `@bibs/api` unit (`test:unit`) | bun test | 65 | 520 | 0 | 0 | 1.51 s | 0 |
| `@bibs/api` integration (`test:integration`) | bun test `--parallel=4 --isolate` | 101 | 969 | 0 | 0 | 305.58 s | 0 |
| `@bibs/admin` | vitest | 23 | 112 | 0 | 0 | 10.02 s | 0 |
| `@bibs/customer` | vitest | 21 | 169 | 0 | 0 | 2.39 s | 0 |
| `@bibs/seller` | vitest | 44 | 206 | 0 | 0 | 16.62 s | 0 |
| **Total** | | **266** | **2,039** | **0** | **0** | | **0** |

Durations are the ones each runner reports; the rest of the 350 s is `docker build` of the test image
(`test:image`), `paraglide:compile` (`pretest` of the three frontends) and process start-up.
`expect()` calls: emails 71, api unit 9,978, api integration 2,353.

**Pre-existing failures: none.** No skipped or todo tests, no `# Unhandled error between tests`.
The `level: error` JSON lines in the api output (Stripe "down", "insufficient funds", `CLEANUP_FAILED`,
`GET /unhandled 500`) are logged on purpose by tests that exercise error paths.

## Rerun on a PR

```bash
bun run test > /tmp/test.log 2>&1; echo "exit $?"
grep -E 'Exited with code|Ran [0-9]+ tests|Tests +[0-9]+|^@bibs/[a-z]+ test: +[0-9]+ (pass|fail|skip)' /tmp/test.log
```

For one api file: `cd apps/api && bun test <path>` (never bare `bun test` for the whole suite: it skips
`--isolate` and `tests/integration/isolation-guard-2.test.ts` fails on purpose).
