# Misc Correctness Sweep (P0.6 + P0.7 + P0.8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent correctness fixes, one PR:
- **(A — P0.6)** `parseCsv` splits on `\n` BEFORE field parsing → a quoted field with an embedded newline (standard Excel/Sheets export) splits mid-field and misaligns every following column: silent data corruption on seller product import + admin category import.
- **(B — P0.7)** Clearing `birthDate` on the profile never persists: the shared card maps `"" → undefined`, JSON drops the key, better-auth's `parseInputData` only writes keys PRESENT in the body → the old value silently survives. (Verified on better-auth 1.6.14: a present `null` IS written to the nullable `birth_date` column.)
- **(C — P0.8)** All 3 apps share a module-level `QueryClient` singleton across SSR requests. Harmless today (only seller prefetches the global municipalities list), but the first per-user loader prefetch becomes a cross-user cache leak. Fix the architecture before it bites.

**Architecture:** (A) rewrite `parseCsv` as a single char-scan state machine over the whole text (quotes can span newlines), preserving every observable behavior consumers rely on: header lowercasing, per-field trim, `""` escaping, blank-line skipping, whitespace-only-quoted-field → empty (an existing integration test depends on it), `ServiceError(400)` on empty input. (B) shared `PersonalInfoCard` sends `null` (key present) instead of `undefined`; widen the prop type through the 3 `onSubmit` sites. (C) `getContext()` returns a FRESH QueryClient on the server, memoizes only in the browser; the provider stops calling `getContext()` independently and receives the router-context client via `Route.useRouteContext()` — guaranteeing loaders and component tree share the same per-request instance.

---

## Pre-flight

- [ ] **Step 0.1: Create the feature branch**

```bash
git checkout main && git pull && git checkout -b fix/misc-correctness
```

---

### Task 1: (A) CSV parser — quoted multi-line fields

**Files:**
- Test: `apps/api/tests/lib/csv.test.ts` (new — the parser has ZERO unit tests today)
- Modify: `apps/api/src/lib/utils/csv.ts` (full rewrite of the parse internals)
- Test: `apps/api/tests/integration/admin-category-import.test.ts` (one alignment regression case)

- [ ] **Step 1.1: Write the failing unit tests**

`apps/api/tests/lib/csv.test.ts` (pure unit — NO testcontainer, follow the `tests/lib/money.test.ts` pattern):

```ts
import { describe, expect, it } from "bun:test";
import { ServiceError } from "@/lib/errors";
import { parseCsv } from "@/lib/utils/csv";

describe("parseCsv", () => {
	// === the bug ===
	it("keeps a quoted embedded newline inside one field", () => {
		const csv = 'name,description\nFoo,"line one\nline two"\nBar,baz';
		const { headers, rows } = parseCsv(csv);
		expect(headers).toEqual(["name", "description"]);
		expect(rows).toEqual([
			["Foo", "line one\nline two"],
			["Bar", "baz"],
		]);
	});

	it("keeps quoted CRLF newlines (Excel export) inside one field", () => {
		const csv = 'name,description\r\nFoo,"line one\r\nline two"\r\nBar,baz';
		const { rows } = parseCsv(csv);
		expect(rows).toEqual([
			["Foo", "line one\nline two"],
			["Bar", "baz"],
		]);
	});

	it("does not misalign rows AFTER a multi-line field", () => {
		const csv = 'name,price\n"Multi\nline product",10.00\nNormale,5.00';
		const { rows } = parseCsv(csv);
		expect(rows).toHaveLength(2);
		expect(rows[1]).toEqual(["Normale", "5.00"]);
	});

	// === behavior preservation (the consumers rely on every one of these) ===
	it("lowercases headers", () => {
		expect(parseCsv("Name,PRICE\nx,1.00").headers).toEqual(["name", "price"]);
	});

	it("trims fields", () => {
		expect(parseCsv("name\n  spaced  ").rows).toEqual([["spaced"]]);
	});

	it("unescapes doubled quotes", () => {
		expect(parseCsv('name\n"say ""hi"""').rows).toEqual([['say "hi"']]);
	});

	it("skips blank lines between records", () => {
		expect(parseCsv("name\nfoo\n\n   \nbar\n").rows).toEqual([
			["foo"],
			["bar"],
		]);
	});

	it("keeps a whitespace-only QUOTED field as an empty-string row", () => {
		// admin-category-import.test.ts depends on '"   "' surfacing as a
		// row-level error (row kept, value trimmed to "") — NOT being dropped
		const { rows } = parseCsv('name\nfoo\n"   "\nbar');
		expect(rows).toEqual([["foo"], [""], ["bar"]]);
	});

	it("keeps comma-only lines as empty-field rows", () => {
		expect(parseCsv("a,b,c\n,,").rows).toEqual([["", "", ""]]);
	});

	it("throws ServiceError(400) on empty input", () => {
		expect(() => parseCsv("")).toThrow(ServiceError);
		expect(() => parseCsv("\n  \n")).toThrow(ServiceError);
	});

	it("throws ServiceError(400) on an unterminated quoted field", () => {
		expect(() => parseCsv('name\n"never closed')).toThrow(ServiceError);
	});
});
```

- [ ] **Step 1.2: Run to verify RED**

Run: `cd apps/api && bun test tests/lib/csv.test.ts`
Expected: FAIL — the 3 "bug" tests fail on the current `split("\n")` implementation (fields split mid-quote, rows misaligned); the unterminated-quote test also fails (currently silently accepted). The behavior-preservation tests should pass against the OLD code — if any of those fails, your expectations are wrong: STOP and re-read the old parser.

- [ ] **Step 1.3: Rewrite the parser**

Replace the ENTIRE content of `apps/api/src/lib/utils/csv.ts` with:

```ts
import { ServiceError } from "@/lib/errors";

/**
 * Parser CSV minimale ma corretto rispetto ai campi quotati multi-riga
 * (RFC 4180): le virgolette possono contenere newline, virgole e `""` escapate.
 * Comportamenti preservati dai consumer (product-import, category-import):
 * header lowercased, campi trimmati, righe vuote saltate, input vuoto → 400.
 */
export function parseCsv(text: string): {
	headers: string[];
	rows: string[][];
} {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	const records: string[][] = [];
	let fields: string[] = [];
	let current = "";
	let inQuotes = false;
	// True se il record corrente ha contenuto "reale" (virgolette, virgole o
	// caratteri non-whitespace): replica il vecchio filtro delle righe bianche
	// SENZA scartare il caso `"   "` (campo quotato di soli spazi, che i
	// consumer segnalano come errore di riga).
	let recordHasContent = false;

	const endField = () => {
		fields.push(current.trim());
		current = "";
	};
	const endRecord = () => {
		endField();
		if (recordHasContent) records.push(fields);
		fields = [];
		recordHasContent = false;
	};

	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];
		if (inQuotes) {
			if (char === '"') {
				if (normalized[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				// dentro le virgolette TUTTO è contenuto, newline inclusi
				current += char;
			}
		} else if (char === '"') {
			inQuotes = true;
			recordHasContent = true;
		} else if (char === ",") {
			endField();
			recordHasContent = true;
		} else if (char === "\n") {
			endRecord();
		} else {
			if (char !== " " && char !== "\t") recordHasContent = true;
			current += char;
		}
	}
	if (inQuotes) {
		throw new ServiceError(400, "Unterminated quoted field in CSV");
	}
	endRecord();

	if (records.length === 0) {
		throw new ServiceError(400, "CSV file is empty");
	}

	const headers = records[0].map((h) => h.toLowerCase());
	const rows = records.slice(1);
	return { headers, rows };
}
```

(The old `parseCsvLine` helper disappears — it was module-private with no other consumer.)

- [ ] **Step 1.4: Run to verify GREEN**

Run: `cd apps/api && bun test tests/lib/csv.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 1.5: Add the end-to-end alignment regression**

In `apps/api/tests/integration/admin-category-import.test.ts`, in the `importStoreCategoriesFromCsv` describe (same style as the existing whitespace-only-quoted case):

```ts
	it("imports a quoted multi-line name without misaligning following rows", async () => {
		const csv = ['name', '"Casa\ne Giardino"', "Barbiere"].join("\n");
		const result = await importStoreCategoriesFromCsv(csv);
		expect(result.created).toBe(2);
		expect(result.failed).toBe(0);
	});
```

- [ ] **Step 1.6: Run the CSV-consumer integration suites**

Run: `cd apps/api && bun test tests/integration/admin-category-import.test.ts --timeout 180000 && bun test tests/integration/seller-products.test.ts --timeout 180000`
Expected: PASS — including the pre-existing `'"   "'` whitespace-only case (row preserved, reported as error) and the product-import flows.

- [ ] **Step 1.7: Commit**

```bash
git add apps/api/src/lib/utils/csv.ts apps/api/tests/lib/csv.test.ts apps/api/tests/integration/admin-category-import.test.ts
git commit -m "fix(api): CSV parser handles quoted multi-line fields (RFC 4180 state machine)"
```

---

### Task 2: (B) birthDate clear persists null

**Files:**
- Modify: `packages/ui/src/components/personal-info-card.tsx` (submit mapping ~lines 108-112 + `onSubmit` prop type ~lines 49-53)
- Modify: `apps/customer/src/routes/_authenticated/profile.tsx:48-60`
- Modify: `apps/admin/src/routes/_authenticated/profile.tsx` (same inline `onSubmit`, byte-identical to customer's)
- Modify: `apps/seller/src/features/profile/components/personal-info-card.tsx:43-55` (the seller's local wrapper — NOT the route)

- [ ] **Step 2.1: Fix the shared card**

In `packages/ui/src/components/personal-info-card.tsx`:

1. The `onSubmit` prop type (lines ~49-53): change `birthDate?: string` to `birthDate: string | null`:

```ts
	onSubmit: (data: {
		firstName: string;
		lastName: string;
		birthDate: string | null;
	}) => Promise<{ error?: string }>;
```

2. The submit call (lines ~108-112): change `birthDate: birthDate || undefined` to:

```ts
		const result = await onSubmit({
			firstName: firstName.trim(),
			lastName: lastName.trim(),
			// null = chiave PRESENTE nel payload → better-auth scrive il clear.
			// undefined verrebbe omesso dal JSON e il vecchio valore resterebbe.
			birthDate: birthDate.trim() === "" ? null : birthDate,
		});
```

- [ ] **Step 2.2: Update the three `onSubmit` definitions**

In each of `apps/customer/src/routes/_authenticated/profile.tsx`, `apps/admin/src/routes/_authenticated/profile.tsx`, and `apps/seller/src/features/profile/components/personal-info-card.tsx`, the inline `onSubmit` has the identical birthDate handling. Update the param type and pass-through:

```ts
	const onSubmit = async (data: {
		firstName: string;
		lastName: string;
		birthDate: string | null;
	}) => {
		const { error } = await authClient.updateUser({
			firstName: data.firstName,
			lastName: data.lastName,
			// better-auth tipizza i campi additional come string|undefined ma
			// accetta e persiste null quando la chiave è presente nel body
			// (parseInputData scrive data[key] così com'è). Il cast esprime il
			// clear esplicito che il tipo inferito non sa rappresentare.
			birthDate: data.birthDate as unknown as string | undefined,
			name: `${data.firstName} ${data.lastName}`,
		});
		return { error: error?.message };
	};
```

First try WITHOUT the `as unknown as` cast (`birthDate: data.birthDate`) — if `inferAdditionalFields<typeof auth>()` happens to admit `null`, prefer the clean form; root `bun run typecheck` is the arbiter. Keep the comment either way. (Seller's wrapper keeps its richer avatar error handling untouched — only the `onSubmit` birthDate typing changes.)

- [ ] **Step 2.3: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS across all 3 apps + packages/ui.

- [ ] **Step 2.4: Manual verification (the only gate — no FE test infra)**

`docker compose up -d && bun run dev`, then on `http://localhost:3001` (customer, logged in):
1. Profile → set a birth date → Salva → reload → date persisted.
2. Clear the date field → Salva → **reload → field EMPTY** (before the fix the old date reappeared).
3. Confirm in DB: `birth_date IS NULL` for the user (dev DB).
4. Spot-check the same clear-flow on seller (`:3002/profile`) and admin (`:3003/profile`).

- [ ] **Step 2.5: Commit**

```bash
git add packages/ui/src/components/personal-info-card.tsx apps/customer/src/routes/_authenticated/profile.tsx apps/admin/src/routes/_authenticated/profile.tsx apps/seller/src/features/profile/components/personal-info-card.tsx
git commit -m "fix(profile): clearing birthDate persists null instead of silently keeping the old value"
```

---

### Task 3: (C) Per-request QueryClient on the server

**Files (the 3 root-providers are byte-identical, the 3 __roots differ only in app branding):**
- Modify: `apps/{admin,seller,customer}/src/integrations/tanstack-query/root-provider.tsx`
- Modify: `apps/{admin,seller,customer}/src/routes/__root.tsx` (`RootDocument`)

- [ ] **Step 3.1: Server-fresh `getContext()` + provider takes the client as a prop**

Replace the ENTIRE content of all three `root-provider.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Browser: un solo QueryClient per la sessione (cache viva tra navigazioni).
// Server: un QueryClient NUOVO a ogni getContext() — cioè a ogni richiesta
// SSR, dato che getRouter() viene invocato per-request — così la cache
// (potenzialmente per-utente) non trapela mai tra richieste concorrenti.
let browserContext: { queryClient: QueryClient } | undefined;

export function getContext(): { queryClient: QueryClient } {
	if (typeof window === "undefined") {
		return { queryClient: new QueryClient() };
	}
	browserContext ??= { queryClient: new QueryClient() };
	return browserContext;
}

export default function TanStackQueryProvider({
	queryClient,
	children,
}: {
	queryClient: QueryClient;
	children: ReactNode;
}) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
```

- [ ] **Step 3.2: Feed the provider from the ROUTER context (same instance as the loaders)**

In each app's `src/routes/__root.tsx`, `RootDocument` currently renders `<TanStackQueryProvider>` with no props (the provider used to call `getContext()` itself — that independent call is exactly what must die: on the server it would now create a SECOND fresh client, divorced from the one the loaders prefetch into). Change the top of `RootDocument`:

```tsx
function RootDocument(_props: { children: React.ReactNode }) {
	// Stesso QueryClient che getRouter() ha messo nel router context (e in cui
	// i loader fanno ensureQueryData): UNICA istanza per request.
	const { queryClient } = Route.useRouteContext();
	return (
		<html lang={getLocale()} suppressHydrationWarning>
```

and pass the prop:

```tsx
				<TanStackQueryProvider queryClient={queryClient}>
```

(Hooks work inside `RootDocument`: it already renders `<Outlet/>`, which requires the same router context. `router.tsx` needs NO change — it already calls `getContext()` per `getRouter()` invocation; the server branch makes that per-request-fresh. Note admin's `router.tsx` imports `getContext` via a relative `./` path instead of `@/` — irrelevant to this fix, don't "fix" it here.)

- [ ] **Step 3.3: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS. (If any OTHER call site of `getContext()` exists beyond `router.tsx` — there shouldn't be, recon found only router.tsx + the provider itself — the compiler will surface it; wire it to the router context instead of calling `getContext()`.)

- [ ] **Step 3.4: SSR verification (memory ritual: curl all 3, then browser)**

```bash
bun run dev   # api + 3 frontends
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002/login
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3003/login
```
Expected: 200 + real HTML on all three (a broken provider wiring would 500 or render empty).

Then in the browser:
1. Seller `:3002` (seller@dev.bibs): open `/store/new` and `/profile` — the **municipality combobox must be populated without errors** (these routes' loaders `ensureQueryData(municipalitiesQueryOptions())` into the router-context client; if the provider client diverged, the combobox would refetch or hang — and the console would show hydration warnings).
2. No hydration warnings in the console on any of the 3 apps' home/login.
3. Devtools panel (Ctrl+Shift+D → Tanstack Query) still shows the queries — `ReactQueryDevtoolsPanel` reads the provider context.

- [ ] **Step 3.5: Commit**

```bash
git add apps/admin/src/integrations/tanstack-query/root-provider.tsx apps/seller/src/integrations/tanstack-query/root-provider.tsx apps/customer/src/integrations/tanstack-query/root-provider.tsx apps/admin/src/routes/__root.tsx apps/seller/src/routes/__root.tsx apps/customer/src/routes/__root.tsx
git commit -m "fix(fe): per-request QueryClient on the server, single instance shared with router loaders"
```

---

### Task 4: Full verification + PR

- [ ] **Step 4.1: Full suites**

```bash
cd apps/api && bun run test && cd ../..
bun run typecheck && bun run lint
```
Expected: all PASS (check `$?` explicitly).

- [ ] **Step 4.2: Push + PR**

```bash
git push -u origin fix/misc-correctness
```

Open the PR with title: `fix: CSV multi-line fields, birthDate clear persistence, per-request SSR QueryClient`

PR body must cover, per fix: (A) the split-before-parse corruption mechanism + the deliberately preserved trim/blank-line/quoted-whitespace semantics + the new 400 on unterminated quotes (previously silently accepted); (B) the undefined-drops-the-key mechanism with the better-auth `parseInputData` line-level evidence, and the (possible) documented cast; (C) the singleton-across-requests hazard, why it's latent today (only global municipalities are prefetched), and the same-instance guarantee between router loaders and component tree.

---

## Notes & gotchas for the implementer

- The three fixes are INDEPENDENT — if one stalls, land the other two; don't hold the PR hostage.
- (A) Do NOT add a CSV dependency (papaparse etc.) — hard rule: no deps outside the root catalog for shared needs; the hand-rolled parser stays.
- (A) The trim-preserving semantics are deliberate: `product-import.ts` does NOT re-trim `name`/`price`/`categories` (only ean/brand), so removing the parser's `.trim()` would silently change validation outcomes.
- (B) `ServiceError`/API untouched — the whole fix is client-side payload shape; better-auth 1.6.14 already persists a present `null`.
- (C) The provider MUST NOT call `getContext()` itself anymore — that's the subtle regression to avoid (two fresh clients per SSR request, loaders prefetching into the one the tree can't see).
- (C) `bun test` does not cover any of this (no FE tests) — the curl + browser pass in Step 3.4 is the gate; memory records a TanStack release shipping broken SSR that only curl caught.
- Biome auto-fixes on Write/Edit (tabs, import order) — let it.
