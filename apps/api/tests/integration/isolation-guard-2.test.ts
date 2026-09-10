import { expect, test } from "bun:test";

/**
 * Guard: asserts `test:integration` really runs with `--isolate`.
 *
 * There are two of these files and their bodies are identical on purpose. Each
 * increments a counter on the global object, then asserts it sees 1 — i.e. that
 * it got a global nobody else has touched. Under `--isolate` every file gets a
 * fresh global, so both see 1. Share one global across files and whichever runs
 * second sees 2 and fails, whatever the order: the check does not care which
 * file bun loads first, which matters because that order is decided by the
 * runner environment.
 *
 * Why guard this at all: a shared global comes with a shared module registry,
 * and that is what lets `mock.module(...)` in one file leak into files loaded
 * after it. 53 of the files here call `mock.module`, and
 * stripe-webhook-reprocessing.test.ts swaps `handleCheckoutCompleted` for a
 * no-op that would silently gut stripe-webhook-checkout-completed.test.ts. That
 * bug is invisible in a passing suite and only appears in orders some runners
 * happen to pick (#146), so it needs a check that fails loudly and everywhere
 * instead of waiting for an unlucky CI image.
 *
 * If this fails: `--isolate` is missing from the `test:integration` script, not
 * broken here. See apps/api/AGENTS.md.
 */
declare global {
	var __bibsIsolationGuard: number | undefined;
}

globalThis.__bibsIsolationGuard = (globalThis.__bibsIsolationGuard ?? 0) + 1;

test("integration tests run with --isolate (guard 2: fresh global per file)", () => {
	expect(globalThis.__bibsIsolationGuard).toBe(1);
});
