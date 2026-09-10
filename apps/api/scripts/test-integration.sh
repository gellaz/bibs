#!/usr/bin/env sh
# Run each integration test file in its OWN bun process.
#
# Why: bun keeps a single module registry per `bun test` process, and
# `mock.module(...)` registrations from one file can bleed into another
# depending on file execution order. That order is decided by the runner
# environment, so the suite is green locally and on some CI images but red on
# others — a heisenbug that surfaced as stripe-webhook-checkout-completed
# no-opping its handler (see the stripe-webhook tests, which each mock
# @/lib/stripe and @/modules/webhooks/services/handlers/*). A fresh process per
# file gives each file a clean registry, so mock isolation no longer depends on
# order. Costs a little wall-clock (extra process starts) for determinism.
#
# Runs every file even after a failure so CI reports all failing files at once.
set -u

failed=""
for f in tests/integration/*.test.ts; do
	if ! bun test "$f" --timeout 180000; then
		failed="$failed $f"
	fi
done

if [ -n "$failed" ]; then
	printf '\nIntegration test files failed:%s\n' "$failed"
	exit 1
fi
