# Billing Correctness (P0.4 + P0.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two money-correctness fixes:
- **(A — P0.4)** Checkout resume can expire a PAID session and create a second subscription: `createCheckoutSession` treats any non-`open` Stripe session (including `complete` = paid, webhook in flight) as "expired or otherwise unusable", flips the pending and creates a brand-new Checkout Session → second subscription if also paid.
- **(B — P0.5)** Seller billing summary reports a `canceling` sub's termination date as "prossimo rinnovo" (and `past_due`'s already-failed period end); admin MRR counts `past_due` + `canceling` fees as recurring revenue.

**Architecture:** All API-side, no migrations, no FE changes (response shapes stay compatible; admin gains an additive `atRiskCents`). (A) adds a `complete` short-circuit in `apps/api/src/modules/seller/services/checkout.ts:54-76` returning the processing-page URL and leaving the pending `open` for the webhook to consume. (B1) computes `nextRenewal` from `active`-only rows in `getBillingSummary` (only `active` actually renews — `canceling` terminates at period end, `past_due` already failed). (B2) accumulates MRR from `active` only and exposes the past_due+canceling sum as a new `atRiskCents`.

**Load-bearing Stripe fact (verified on stripe v22.2.0):** `Checkout.Session.status ∈ 'open' | 'complete' | 'expired' | null`. There is no `'paid'` status — payment lives in `session.payment_status`.

**Heads-up:** the two existing integration tests LITERALLY assert the buggy behavior (`seller-billing-summary.test.ts:70-90` expects the canceling sub's date as nextRenewal; `admin-billing-overview.test.ts:65-91` expects MRR with past_due+canceling). TDD here = rewrite those assertions first (RED), then fix.

---

## Pre-flight

- [ ] **Step 0.1: Create the feature branch**

```bash
git checkout main && git pull && git checkout -b fix/billing-correctness
```

---

### Task 1: (A) Checkout resume — `complete` short-circuit

**Files:**
- Test: `apps/api/tests/integration/seller-stores-checkout.test.ts`
- Modify: `apps/api/src/modules/seller/services/checkout.ts:54-76`

- [ ] **Step 1.1: Write the failing test**

In `apps/api/tests/integration/seller-stores-checkout.test.ts`, next to the existing expired-resume test (~lines 240-285; reuse its exact mock idiom — `sessionRetrieve`/`sessionCreate` are the file's module-level `mock(async () => …)` stubs, `VALID_BODY` and the `pricingConfig` `beforeEach` seed already exist):

```ts
	it("does not recreate the session when the existing one is complete (paid, webhook in flight)", async () => {
		const { profile } = await createTestSeller(getTestDb(), { email: "complete@b.it" });
		const first = await createCheckoutSession({
			sellerProfileId: profile.id,
			body: VALID_BODY,
		});

		// Resume after payment but before the webhook landed:
		sessionRetrieve.mockImplementationOnce(
			async () =>
				({
					id: "cs_FAKE",
					url: "https://stripe.test/checkout/cs_FAKE",
					status: "complete",
				}) as any,
		);

		const second = await createCheckoutSession({
			sellerProfileId: profile.id,
			body: VALID_BODY,
		});

		// Same pending, NO second Stripe session, redirect to the processing page
		expect(second.pendingStoreCreationId).toBe(first.pendingStoreCreationId);
		expect(sessionCreate).toHaveBeenCalledTimes(1);
		expect(second.checkoutUrl).toContain("/store/new/processing");

		// The pending must stay 'open' so handleCheckoutCompleted can consume it
		const [pending] = await getTestDb()
			.select()
			.from(pendingStoreCreation)
			.where(eq(pendingStoreCreation.id, first.pendingStoreCreationId));
		expect(pending.status).toBe("open");
	});
```

(Align the `pendingStoreCreation`/`eq` imports with what the file already imports — the expired-case test already reads the pending row.)

- [ ] **Step 1.2: Run to verify RED**

Run: `cd apps/api && bun test tests/integration/seller-stores-checkout.test.ts --timeout 180000`
Expected: the new test FAILS — today `pendingStoreCreationId` differs (a second pending is created), `sessionCreate` is called twice, and the original pending is flipped to `"expired"`. The pre-existing tests must still pass.

- [ ] **Step 1.3: Implement the short-circuit**

In `apps/api/src/modules/seller/services/checkout.ts`, the resume block currently reads (lines 54-76):

```ts
	if (existing?.stripeCheckoutSessionId) {
		const session = await stripe.checkout.sessions.retrieve(
			existing.stripeCheckoutSessionId,
		);
		if (session.status === "open") {
			return {
				checkoutUrl: session.url ?? "",
				pendingStoreCreationId: existing.id,
			};
		}
		// Session is expired or otherwise unusable — expire the pending and fall through to create a fresh one
		await db
			.update(pendingStoreCreation)
			.set({ status: "expired" })
			.where(eq(pendingStoreCreation.id, existing.id));
	}
```

Replace with:

```ts
	if (existing?.stripeCheckoutSessionId) {
		const session = await stripe.checkout.sessions.retrieve(
			existing.stripeCheckoutSessionId,
		);
		if (session.status === "open") {
			return {
				checkoutUrl: session.url ?? "",
				pendingStoreCreationId: existing.id,
			};
		}
		if (session.status === "complete") {
			// Già pagata: checkout.session.completed consumerà questo pending
			// (o l'ha appena fatto). NON va né espirato né ricreato — farlo qui
			// creava una SECONDA session e quindi una seconda subscription.
			// Rimandiamo il seller alla pagina di processing che polla lo stato.
			return {
				checkoutUrl: `${env.SELLER_APP_URL}/store/new/processing?session_id=${session.id}`,
				pendingStoreCreationId: existing.id,
			};
		}
		// Session expired (o status nullo anomalo) — expire the pending and
		// fall through to create a fresh one
		await db
			.update(pendingStoreCreation)
			.set({ status: "expired" })
			.where(eq(pendingStoreCreation.id, existing.id));
	}
```

(`env` is already imported in this file — it builds `success_url`/`cancel_url` from `env.SELLER_APP_URL`. The short-circuit sits BEFORE the orphan-reuse branch at lines ~106-134, which must never run for a paid session.)

- [ ] **Step 1.4: Run to verify GREEN**

Run: `cd apps/api && bun test tests/integration/seller-stores-checkout.test.ts --timeout 180000`
Expected: ALL tests pass (new one + the expired-resume case + the rest).

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/src/modules/seller/services/checkout.ts apps/api/tests/integration/seller-stores-checkout.test.ts
git commit -m "fix(api): never expire a paid checkout session on resume (double-subscription guard)"
```

---

### Task 2: (B1) Seller summary — nextRenewal from active-only

**Files:**
- Test: `apps/api/tests/integration/seller-billing-summary.test.ts`
- Modify: `apps/api/src/modules/seller/services/billing.ts` (`getBillingSummary`, ~lines 34-72)

- [ ] **Step 2.1: Rewrite the assertion that encodes the bug + add the null case (RED)**

In `apps/api/tests/integration/seller-billing-summary.test.ts`, the existing test (lines ~71-90) seeds active(periodEnd 2027-01-24) / past_due(2027-01-10) / canceling(2027-01-05) / suspended / canceled and asserts `nextRenewal.date === 2027-01-05` (the CANCELING sub — i.e. the bug). Change ONLY the nextRenewal assertion:

```ts
		// nextRenewal = il primo rinnovo che AVVERRÀ davvero: solo 'active' rinnova.
		// canceling termina a fine periodo, past_due ha già fallito il rinnovo.
		expect(summary.nextRenewal?.date.toISOString()).toBe(
			new Date("2027-01-24").toISOString(),
		);
		expect(summary.nextRenewal?.storeId).toBeDefined();
```

(Leave `activeStoresCount: 3` and `totalMonthlyCents: 2900*3` untouched — the billable-set semantics of those two figures, "what you're paying this period", are intentionally unchanged.)

Then ADD a new test in the same describe:

```ts
	it("returns nextRenewal null when no sub will actually renew", async () => {
		const { profile } = await createTestSeller(getTestDb(), { email: "norenew@b.it" });
		await seedSubs(profile.id, [
			{ status: "past_due", fee: 2900, periodEnd: new Date("2027-01-10") },
			{ status: "canceling", fee: 2900, periodEnd: new Date("2027-01-05") },
		]);

		const summary = await getBillingSummary({ sellerProfileId: profile.id });

		expect(summary.activeStoresCount).toBe(2); // billable set unchanged
		expect(summary.totalMonthlyCents).toBe(2900 * 2);
		expect(summary.nextRenewal).toBeNull();
	});
```

- [ ] **Step 2.2: Run to verify RED**

Run: `cd apps/api && bun test tests/integration/seller-billing-summary.test.ts --timeout 180000`
Expected: both the rewritten assertion (gets 2027-01-05, wants 2027-01-24) and the new test (gets the canceling row, wants null) FAIL.

- [ ] **Step 2.3: Fix `getBillingSummary`**

In `apps/api/src/modules/seller/services/billing.ts`, replace the `nextRenewal` computation (currently `rows[0]` of the billable set, ordered asc by `currentPeriodEnd`):

```ts
	const nextRenewal =
		rows.length > 0
			? {
					storeId: rows[0].storeId,
					storeName: rows[0].storeName,
					date: rows[0].currentPeriodEnd,
					amountCents: rows[0].feeAmountCents,
				}
			: null;
```

with:

```ts
	// Solo 'active' rinnova davvero: 'canceling' termina a currentPeriodEnd,
	// 'past_due' ha già fallito il rinnovo. rows è già in ASC per periodEnd.
	const renewing = rows.filter((r) => r.status === "active");
	const nextRenewal =
		renewing.length > 0
			? {
					storeId: renewing[0].storeId,
					storeName: renewing[0].storeName,
					date: renewing[0].currentPeriodEnd,
					amountCents: renewing[0].feeAmountCents,
				}
			: null;
```

(`totalMonthlyCents` and `activeStoresCount` stay computed from the full billable `rows`.)

- [ ] **Step 2.4: Run to verify GREEN**

Run: `cd apps/api && bun test tests/integration/seller-billing-summary.test.ts --timeout 180000`
Expected: PASS. (`SummarySchema` is unchanged; the seller FE already renders whatever `nextRenewal` says — no FE edit.)

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/modules/seller/services/billing.ts apps/api/tests/integration/seller-billing-summary.test.ts
git commit -m "fix(api): seller billing nextRenewal considers only subscriptions that will renew"
```

---

### Task 3: (B2) Admin overview — MRR active-only + `atRiskCents`

**Files:**
- Test: `apps/api/tests/integration/admin-billing-overview.test.ts`
- Modify: `apps/api/src/modules/admin/services/billing.ts` (`getBillingOverview`, ~lines 15-53)
- Modify: `apps/api/src/modules/admin/routes/billing.ts` (`OverviewSchema`, ~lines 42-48)

- [ ] **Step 3.1: Rewrite the MRR assertion + assert atRiskCents (RED)**

In `apps/api/tests/integration/admin-billing-overview.test.ts` (~lines 66-91), the seed is: seller a → active 2900 + past_due 2900 + suspended 2900 + canceled 2900; seller b → active 1900 + canceling 1900. Change:

```ts
		expect(o.mrrCents).toBe(2900 + 2900 + 1900 + 1900);
```

to:

```ts
		// MRR = solo revenue RICORRENTE: active. past_due (incasso fallito) e
		// canceling (non rinnoverà) sono revenue a rischio, esposta a parte.
		expect(o.mrrCents).toBe(2900 + 1900);
		expect(o.atRiskCents).toBe(2900 + 1900); // past_due(a) + canceling(b)
```

(The count assertions — `activeStoresCount: 2`, `pastDueCount: 1`, `suspendedCount: 1`, `cancelingCount: 1` — stay as-is.)

- [ ] **Step 3.2: Run to verify RED**

Run: `cd apps/api && bun test tests/integration/admin-billing-overview.test.ts --timeout 180000`
Expected: FAIL — `mrrCents` comes back as 9600 and `atRiskCents` is undefined.

- [ ] **Step 3.3: Fix `getBillingOverview`**

In `apps/api/src/modules/admin/services/billing.ts`, update the accumulator block:

```ts
	let mrrCents = 0;
	let atRiskCents = 0;
	let activeStoresCount = 0;
	let pastDueCount = 0;
	let cancelingCount = 0;
	let suspendedCount = 0;

	for (const r of rows) {
		if (r.status === "active") {
			activeStoresCount = r.count;
			mrrCents += r.sumCents;
		} else if (r.status === "past_due") {
			pastDueCount = r.count;
			atRiskCents += r.sumCents;
		} else if (r.status === "canceling") {
			cancelingCount = r.count;
			atRiskCents += r.sumCents;
		} else if (r.status === "suspended") {
			suspendedCount = r.count;
		}
	}

	return {
		mrrCents,
		atRiskCents,
		activeStoresCount,
		pastDueCount,
		cancelingCount,
		suspendedCount,
	};
```

- [ ] **Step 3.4: Extend `OverviewSchema`**

In `apps/api/src/modules/admin/routes/billing.ts` (~line 43), add after `mrrCents`:

```ts
	atRiskCents: t.Integer({
		description:
			"Somma fee di subscription past_due + canceling: revenue mensile a rischio, esclusa dall'MRR",
	}),
```

(Additive field — the admin FE billing page renders mrr/active/pastDue/suspended and ignores unknown fields; no FE change required. Surfacing `atRiskCents` in the UI is future work, not this PR.)

- [ ] **Step 3.5: Run to verify GREEN + typecheck**

```bash
cd apps/api && bun test tests/integration/admin-billing-overview.test.ts --timeout 180000 && cd ../.. && bun run typecheck
```
Expected: tests PASS, typecheck PASS (Eden propagation of the new field).

- [ ] **Step 3.6: Commit**

```bash
git add apps/api/src/modules/admin/services/billing.ts apps/api/src/modules/admin/routes/billing.ts apps/api/tests/integration/admin-billing-overview.test.ts
git commit -m "fix(api): admin MRR counts active-only; expose past_due+canceling as atRiskCents"
```

---

### Task 4: Full verification + PR

- [ ] **Step 4.1: Full API suite + lint**

```bash
cd apps/api && bun run test && cd ../..
bun run typecheck && bun run lint
```
Expected: all PASS (check `$?` explicitly).

- [ ] **Step 4.2: Browser spot-check (billing dashboards)**

`docker compose up -d && bun run dev`, then:
1. Seller `http://localhost:3002/billing` (seller@dev.bibs / password123): "Prossimo rinnovo" renders (seeded subs are active → value unchanged vs before; the fix only bites with canceling/past_due seeds).
2. Admin `http://localhost:3003/billing`: MRR renders; no UI errors from the additive `atRiskCents`.

- [ ] **Step 4.3: Push + PR**

```bash
git push -u origin fix/billing-correctness
```

Open the PR with title: `fix(api): billing correctness — paid-session resume guard, honest nextRenewal & MRR`

PR body must cover: (A) the `complete`-status leak ("expired or otherwise unusable" comment was the bug), why the pending must stay `open` for the webhook, the processing-URL return; (B) renewal semantics (`canceling` terminates, `past_due` already failed), the deliberate non-change of `totalMonthlyCents`/`activeStoresCount` (billable-set semantics), `atRiskCents` as additive; and that BOTH pre-existing tests encoded the buggy behavior and were rewritten.

---

## Notes & gotchas for the implementer

- `Checkout.Session.status` has NO `'paid'` value — never branch on it; `'complete'` + `payment_status === 'paid'` is the paid signal (the webhook handler already guards `payment_status`).
- The Stripe client in tests is a `mock.module("@/lib/stripe", ...)` fake object — extend the existing stubs, don't add network mocking.
- The webhook handler REVIVES expired/canceled pendings (PR #72) — that protects the FIRST payment, but cannot dedupe a SECOND distinct subscription; that's why (A) must prevent creation, not rely on reconciliation.
- `ServiceError(status, message)` two-arg only; no error paths change in this plan anyway.
- Eden date hydration: `nextRenewal.date` is `t.Date()` and arrives as a `Date` on the treaty client — the seller FE already coerces; don't change the wire type.
- No migrations: both fixes are pure query/branch logic.
