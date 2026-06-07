# Store Opening-Hours Fixes (P0.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 4 residual opening-hours bugs from PR #73/#78 + add the missing overlap/close>open validation. These hours feed the customer-facing `openStatus`, so wrong data = wrong "Aperto adesso".

**Bugs & root causes (from recon):**
1. **All-days-off silently dropped** — `store-form.tsx:134` maps `openingHours.length > 0 ? openingHours : undefined`; Eden does not serialize `undefined` → PATCH never sees the field → old hours survive. The API already accepts `null` to clear (`t.Optional(t.Nullable(OpeningHoursSchema))` + Drizzle `.set({openingHours: null})` works).
2. **(bug #3) Null-hours store shows DEFAULT hours and persists them** — `store/index.tsx:171` passes `openingHours: ... ?? undefined` → form seeds `DEFAULT_OPENING_HOURS` (Mon-Sat 9-13/14:30-19); any unrelated save then persists those fabricated defaults.
3. **(bug #4) Save stays enabled after save** — the form never `reset()`s nor re-baselines the `initialOpeningHours` snapshot.
4. **(bug #5) Phantom isDirty on websiteUrl** — `register("websiteUrl", { setValueAs: v => v || undefined })` vs default `""` → RHF compares `undefined !== ""` → dirty with zero edits.
5. **No close>open / overlap validation** anywhere (client or server). `getOpenStatus` silently treats inverted slots as never-open.

**Architecture:** FE: send `null` when all days are off; seed `[]` (not defaults) for null-hours stores on the edit page; re-baseline form state on a `lastSavedAt` prop bump; drop the harmful `setValueAs`; pure client validator with per-day inline errors. API: pure `validateOpeningHours` helper in `lib/`, wired into `updateStore` + the create/checkout body path, `ServiceError(400)`; `CreateStoreBody.openingHours` becomes nullable for parity.

**Day convention (load-bearing):** 0 = Monday … 6 = Sunday, everywhere. HH:mm zero-padded strings compare correctly with `<`/`<=` (lexicographic ≡ chronological).

---

## Pre-flight

- [ ] **Step 0.1: Create the feature branch**

```bash
git checkout main && git pull && git checkout -b fix/store-opening-hours
```

---

### Task 1: Server-side semantic validator (pure, TDD)

**Files:**
- Create: `apps/api/src/lib/opening-hours.ts`
- Test: `apps/api/tests/lib/opening-hours.test.ts`

- [ ] **Step 1.1: Write the failing unit tests**

`apps/api/tests/lib/opening-hours.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { validateOpeningHours } from "@/lib/opening-hours";

describe("validateOpeningHours", () => {
	it("accepts a valid week (sorted and unsorted slots)", () => {
		expect(
			validateOpeningHours([
				{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }, { open: "14:30", close: "19:00" }] },
				{ dayOfWeek: 5, slots: [{ open: "14:30", close: "19:00" }, { open: "09:00", close: "13:00" }] },
			]),
		).toBeNull();
	});

	it("accepts an empty array (all days closed)", () => {
		expect(validateOpeningHours([])).toBeNull();
	});

	it("accepts touching slots (close == next open)", () => {
		expect(
			validateOpeningHours([
				{ dayOfWeek: 2, slots: [{ open: "09:00", close: "13:00" }, { open: "13:00", close: "19:00" }] },
			]),
		).toBeNull();
	});

	it("rejects an inverted slot (close <= open)", () => {
		expect(
			validateOpeningHours([
				{ dayOfWeek: 1, slots: [{ open: "19:00", close: "09:00" }] },
			]),
		).toContain("chiusura");
	});

	it("rejects a zero-length slot", () => {
		expect(
			validateOpeningHours([
				{ dayOfWeek: 1, slots: [{ open: "09:00", close: "09:00" }] },
			]),
		).toContain("chiusura");
	});

	it("rejects overlapping slots", () => {
		expect(
			validateOpeningHours([
				{ dayOfWeek: 3, slots: [{ open: "09:00", close: "13:00" }, { open: "12:00", close: "18:00" }] },
			]),
		).toContain("sovrappongono");
	});

	it("rejects duplicate dayOfWeek entries", () => {
		expect(
			validateOpeningHours([
				{ dayOfWeek: 4, slots: [{ open: "09:00", close: "13:00" }] },
				{ dayOfWeek: 4, slots: [{ open: "15:00", close: "19:00" }] },
			]),
		).toContain("duplicato");
	});
});
```

- [ ] **Step 1.2: Run to verify RED**

Run: `cd apps/api && bun test tests/lib/opening-hours.test.ts`
Expected: FAIL — module `@/lib/opening-hours` does not exist.

- [ ] **Step 1.3: Implement the validator**

`apps/api/src/lib/opening-hours.ts`:

```ts
interface TimeSlot {
	open: string;
	close: string;
}

interface DaySchedule {
	dayOfWeek: number;
	slots: TimeSlot[];
}

/**
 * Valida la coerenza semantica degli orari di apertura (il FORMATO HH:mm e i
 * range di dayOfWeek sono già garantiti dallo schema TypeBox a monte):
 * - chiusura strettamente successiva all'apertura per ogni fascia;
 * - nessuna sovrapposizione tra fasce dello stesso giorno (il confine
 *   close == open della successiva è ammesso: close è esclusivo in getOpenStatus);
 * - nessun giorno duplicato.
 * Convenzione: 0 = lunedì … 6 = domenica. Le stringhe HH:mm zero-padded si
 * confrontano correttamente in ordine lessicografico.
 * Ritorna un messaggio d'errore (italiano, per ServiceError) o null se valido.
 */
export function validateOpeningHours(hours: DaySchedule[]): string | null {
	const seenDays = new Set<number>();
	for (const day of hours) {
		if (seenDays.has(day.dayOfWeek))
			return `Giorno duplicato negli orari (dayOfWeek ${day.dayOfWeek})`;
		seenDays.add(day.dayOfWeek);

		const sorted = [...day.slots].sort((a, b) => (a.open < b.open ? -1 : 1));
		for (const slot of sorted) {
			if (slot.close <= slot.open)
				return `L'orario di chiusura (${slot.close}) deve essere successivo all'apertura (${slot.open})`;
		}
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i].open < sorted[i - 1].close)
				return `Le fasce orarie ${sorted[i - 1].open}-${sorted[i - 1].close} e ${sorted[i].open}-${sorted[i].close} si sovrappongono`;
		}
	}
	return null;
}
```

- [ ] **Step 1.4: Run to verify GREEN**

Run: `cd apps/api && bun test tests/lib/opening-hours.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/src/lib/opening-hours.ts apps/api/tests/lib/opening-hours.test.ts
git commit -m "feat(api): semantic opening-hours validator (close>open, overlap, duplicate day)"
```

---

### Task 2: Wire the validator + clear-hours coverage (API)

**Files:**
- Modify: `apps/api/src/modules/seller/services/stores.ts` (`updateStore`, ~line 210)
- Modify: `apps/api/src/lib/schemas/forms/stores.ts` (`CreateStoreBody.openingHours`, ~line 74)
- Modify: the create/checkout entry service that consumes `CreateStoreBody` (locate via `grep -rn "CreateStoreBody" apps/api/src` — the seller checkout path)
- Test: `apps/api/tests/integration/seller-stores.test.ts`
- Test: `apps/api/tests/modules/store-update-validation.test.ts`

- [ ] **Step 2.1: Write the failing integration tests**

In `apps/api/tests/integration/seller-stores.test.ts`, inside the existing `updateStore` describe block (follow the file's existing fixture pattern — `createTestSeller` + `createTestStore` + direct service calls):

```ts
	it("clears openingHours when null is passed", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id);
		await db
			.update(storeTable)
			.set({ openingHours: [{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] }] })
			.where(eq(storeTable.id, testStore.id));

		await updateStore({
			storeId: testStore.id,
			sellerProfileId: seller.profile.id,
			openingHours: null,
		});

		const [row] = await db.select().from(storeTable).where(eq(storeTable.id, testStore.id));
		expect(row.openingHours).toBeNull();
	});

	it("rejects inverted opening-hours slots with 400", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id);

		await expect(
			updateStore({
				storeId: testStore.id,
				sellerProfileId: seller.profile.id,
				openingHours: [{ dayOfWeek: 1, slots: [{ open: "19:00", close: "09:00" }] }],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("rejects overlapping opening-hours slots with 400", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id);

		await expect(
			updateStore({
				storeId: testStore.id,
				sellerProfileId: seller.profile.id,
				openingHours: [
					{
						dayOfWeek: 3,
						slots: [
							{ open: "09:00", close: "13:00" },
							{ open: "12:00", close: "18:00" },
						],
					},
				],
			}),
		).rejects.toMatchObject({ status: 400 });
	});
```

(Align import names with what the file already imports: `storeTable` vs `store`, `eq`, `updateStore`. If `ServiceError` matching differs in this file's style — e.g. `rejects.toThrow(ServiceError)` — keep `toMatchObject({ status: 400 })`, it's more precise.)

- [ ] **Step 2.2: Run to verify RED**

Run: `cd apps/api && bun test tests/integration/seller-stores.test.ts --timeout 180000`
Expected: the 2 "rejects…" tests FAIL (no validation exists). The "clears…" test should already PASS (the service mechanism works — it documents the contract the FE fix relies on). If it fails, STOP: the null-clear assumption is wrong, re-investigate before the FE work.

- [ ] **Step 2.3: Wire the validator into `updateStore`**

In `apps/api/src/modules/seller/services/stores.ts`, at the top of `updateStore` (right after the `const { storeId, sellerProfileId, phoneNumbers, ...data } = params;` destructure, ~line 210), add:

```ts
	if (Array.isArray(data.openingHours)) {
		const hoursError = validateOpeningHours(data.openingHours);
		if (hoursError) throw new ServiceError(400, hoursError);
	}
```

with the import:

```ts
import { validateOpeningHours } from "@/lib/opening-hours";
```

- [ ] **Step 2.4: Wire the same guard into the create/checkout path**

Run `grep -rn "CreateStoreBody\|openingHours" apps/api/src/modules/seller/services/checkout.ts apps/api/src/modules/seller/services/stores.ts` to locate where the create-store payload enters (the `new.tsx` flow goes through checkout → pending-store payload → store row created on webhook). At the entry-point service that accepts the form payload (so the seller gets the 400 upfront, not at webhook time), add the same 4-line guard.

- [ ] **Step 2.5: Make `CreateStoreBody.openingHours` nullable (parity with PATCH)**

In `apps/api/src/lib/schemas/forms/stores.ts` (~line 74), change:

```ts
			openingHours: Type.Optional(OpeningHoursSchema),
```

to:

```ts
			openingHours: Type.Optional(Type.Union([OpeningHoursSchema, Type.Null()])),
```

(The FE submit mapping will send `null` for all-days-off on BOTH create and edit — the create flow must not 422.)

- [ ] **Step 2.6: Add the schema-level regression to the bare-mount validation test**

In `apps/api/tests/modules/store-update-validation.test.ts`, following the file's existing pattern (`not.toBe(422)` for valid bodies):

```ts
	it("accepts openingHours: null on PATCH (clear hours)", async () => {
		const res = await patch("/some-store-id", { openingHours: null });
		expect(res.status).not.toBe(422);
	});
```

(Adapt the helper name/path to the file's existing `patch` helper.)

- [ ] **Step 2.7: Run to verify GREEN**

```bash
cd apps/api && bun test tests/integration/seller-stores.test.ts --timeout 180000 && bun test tests/modules/store-update-validation.test.ts && bun run test:unit
```
Expected: all PASS.

- [ ] **Step 2.8: Commit**

```bash
git add apps/api
git commit -m "fix(api): enforce opening-hours semantics on store create/update, nullable create body"
```

---

### Task 3: FE — clear-on-all-off + no default-hours leak (bugs #1 + #3)

**Files:**
- Modify: `apps/seller/src/features/stores/components/store-form.tsx:128-145` (submit mapping) + the `StoreFormData`/props type where `openingHours` is declared
- Modify: `apps/seller/src/routes/_authenticated/store/index.tsx:163-177` (defaultValues mapping)

- [ ] **Step 3.1: Send `null` instead of dropping the field**

In `store-form.tsx`, `onFormSubmit` (~line 134), change:

```tsx
			openingHours: openingHours.length > 0 ? openingHours : undefined,
```

to:

```tsx
			// [] (tutti i giorni chiusi) deve viaggiare come null: Eden non
			// serializza undefined e il PATCH non vedrebbe mai il clear.
			openingHours: openingHours.length > 0 ? openingHours : null,
```

Update the `openingHours` declaration in the form-data type (where `StoreFormData` / the `onSubmit` payload type declares it — in this file or the feature's schema file; find with `grep -rn "openingHours" apps/seller/src/features/stores`) to admit `null`:

```ts
	openingHours?: DaySchedule[] | null;
```

- [ ] **Step 3.2: Stop seeding defaults for null-hours stores (edit page only)**

In `apps/seller/src/routes/_authenticated/store/index.tsx` (~line 171), change:

```tsx
				openingHours: (store.openingHours as never) ?? undefined,
```

to:

```tsx
				// null a DB = nessun orario impostato → l'editor parte con tutti i
				// giorni chiusi (lo stato VERO), non con i default di comodo che
				// altrimenti verrebbero persistiti da un save non correlato.
				openingHours: (store.openingHours as never) ?? [],
```

The create page (`store/new.tsx`) is untouched: with `defaultValues` absent the form still seeds `DEFAULT_OPENING_HOURS` as a convenience — correct for a brand-new store.

(`store-form.tsx`'s initializer `defaultValues?.openingHours ?? DEFAULT_OPENING_HOURS…` keeps working: `[]` is not nullish, so it survives as-is.)

- [ ] **Step 3.3: Typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 4: FE — post-save re-baseline + phantom dirty (bugs #4 + #5)

**Files:**
- Modify: `apps/seller/src/features/stores/components/store-form.tsx` (props, `useForm` destructure, snapshot state, new effect, `register("websiteUrl")`)
- Modify: `apps/seller/src/routes/_authenticated/store/index.tsx` (mutation `onSuccess` + new prop)

- [ ] **Step 4.1: Kill the phantom isDirty**

In `store-form.tsx` (~lines 332-334), change:

```tsx
				{...register("websiteUrl", { setValueAs: (v) => v || undefined })}
```

to:

```tsx
				{...register("websiteUrl")}
```

(The `""` → `undefined` normalization already happens in `onFormSubmit`'s `cleaned` mapping — the `setValueAs` was redundant AND made RHF compare `undefined !== ""` ⇒ dirty with zero edits.)

Verify the edit page passes a string default: in `index.tsx` defaultValues, `websiteUrl` must map as `store.websiteUrl ?? ""` (fix it if it currently passes `null`/`undefined`).

- [ ] **Step 4.2: Add the `lastSavedAt` re-baseline**

In `store-form.tsx`:

1. Add to the component's props: `lastSavedAt?: number;`
2. Give the snapshot state a setter (currently `const [initialOpeningHours] = useState…`):

```tsx
	const [initialOpeningHours, setInitialOpeningHours] = useState<DaySchedule[]>(
```

3. Destructure `reset` and `getValues` from `useForm` (alongside the existing `register, handleSubmit, control, watch, formState`).
4. Add the effect:

```tsx
	// Re-baseline dopo un save riuscito: i valori correnti diventano i nuovi
	// default (isDirty→false) e lo snapshot orari viene riallineato, così il
	// bottone Salva si disabilita finché non c'è una nuova modifica.
	// biome-ignore lint/correctness/useExhaustiveDependencies: deve scattare SOLO al bump di lastSavedAt — includere openingHours azzererebbe la dirty-detection a ogni modifica
	useEffect(() => {
		if (!lastSavedAt) return;
		reset(getValues());
		setInitialOpeningHours(
			openingHours.map((d) => ({ ...d, slots: d.slots.map((s) => ({ ...s })) })),
		);
	}, [lastSavedAt]);
```

Memory gotcha check (`feedback_rhf_reset_unstable_defaultvalues`): this is safe — the effect fires only on `lastSavedAt` bumps (not every render), and `reset(getValues())` keeps the current values, so the Controller-driven `MunicipalityCombobox` keeps its selection.

- [ ] **Step 4.3: Bump `lastSavedAt` from the mutation**

In `apps/seller/src/routes/_authenticated/store/index.tsx`:

```tsx
	const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
```

In `updateMutation`'s `onSuccess` (lines ~103-132, where the invalidations + toast already happen), add:

```tsx
			setLastSavedAt(Date.now());
```

and pass the prop where `StoreForm` is rendered (~line 162):

```tsx
			<StoreForm
				key={activeStore.id}
				lastSavedAt={lastSavedAt}
				…existing props…
			/>
```

(The `key={activeStore.id}` remount on store switch is untouched — `lastSavedAt` only handles same-store saves.)

- [ ] **Step 4.4: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS

- [ ] **Step 4.5: Commit**

```bash
git add apps/seller
git commit -m "fix(seller): store form — clear hours on all-off, no default-hours leak, post-save reset, phantom dirty"
```

---

### Task 5: FE — client-side hours validation with inline errors

**Files:**
- Create: `apps/seller/src/features/stores/lib/validate-opening-hours.ts`
- Modify: `apps/seller/src/features/stores/components/store-form.tsx` (compute errors, block submit, disable Save)
- Modify: `apps/seller/src/features/stores/components/opening-hours-editor.tsx` (render per-day error)
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`

- [ ] **Step 5.1: Add the i18n keys**

`apps/seller/messages/it.json` (next to the existing `store.closures.*` block — same dotted convention):

```json
	"store.form.hours_invalid_slot": "L'orario di chiusura deve essere successivo all'apertura",
	"store.form.hours_overlap": "Le fasce orarie si sovrappongono",
```

`apps/seller/messages/en.json`:

```json
	"store.form.hours_invalid_slot": "Closing time must be after opening time",
	"store.form.hours_overlap": "Time slots overlap",
```

- [ ] **Step 5.2: Create the client validator**

`apps/seller/src/features/stores/lib/validate-opening-hours.ts` (deliberate small duplication of the API validator — there is no shared package for it yet; see `cross-workspace-alias-tightening` in the gap analysis). Import `DaySchedule` from wherever `store-form.tsx` imports it (the opening-hours-editor module):

```ts
import { m } from "@/paraglide/messages";
import type { DaySchedule } from "../components/opening-hours-editor";

/**
 * Mirror client-side del validator API (apps/api/src/lib/opening-hours.ts).
 * Ritorna una mappa dayOfWeek → messaggio per il rendering inline per-giorno.
 * HH:mm zero-padded: il confronto lessicografico è quello cronologico.
 */
export function validateOpeningHours(
	hours: DaySchedule[],
): Record<number, string> {
	const errors: Record<number, string> = {};
	for (const day of hours) {
		const sorted = [...day.slots].sort((a, b) => (a.open < b.open ? -1 : 1));
		for (const slot of sorted) {
			if (slot.close <= slot.open) {
				errors[day.dayOfWeek] = m["store.form.hours_invalid_slot"]();
				break;
			}
		}
		if (errors[day.dayOfWeek]) continue;
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i].open < sorted[i - 1].close) {
				errors[day.dayOfWeek] = m["store.form.hours_overlap"]();
				break;
			}
		}
	}
	return errors;
}
```

(If `DaySchedule` is not exported from the editor, export it there — it's already the de-facto shared type of the feature.)

- [ ] **Step 5.3: Wire it into the form**

In `store-form.tsx`:

```tsx
import { useMemo } from "react"; // estendi l'import react esistente
import { validateOpeningHours } from "../lib/validate-opening-hours";
```

```tsx
	const hoursErrors = useMemo(
		() => validateOpeningHours(openingHours),
		[openingHours],
	);
	const hoursInvalid = Object.keys(hoursErrors).length > 0;
```

Guard the submit (top of `onFormSubmit`):

```tsx
		if (hoursInvalid) return;
```

Extend the Save button's disabled condition (~line 349):

```tsx
								disabled={
									isPending || (!isDirty && !openingHoursDirty) || hoursInvalid
								}
```

Pass the errors to the editor (where `<OpeningHoursEditor value={openingHours} onChange={setOpeningHours} …/>` is rendered):

```tsx
				dayErrors={hoursErrors}
```

- [ ] **Step 5.4: Render per-day errors in the editor**

In `opening-hours-editor.tsx`: add to props `dayErrors?: Record<number, string>;` and, inside the per-day row rendering (after the slots list for each day), add:

```tsx
				{dayErrors?.[day.dayOfWeek] && (
					<p className="text-sm text-destructive">
						{dayErrors[day.dayOfWeek]}
					</p>
				)}
```

(Adapt placement to the row's existing JSX structure — the error belongs under the day's slot inputs.)

- [ ] **Step 5.5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS

- [ ] **Step 5.6: Commit**

```bash
git add apps/seller
git commit -m "feat(seller): inline close>open and overlap validation on opening hours"
```

---

### Task 6: Browser verification + PR

UI changes require a real browser pass. Boot: `docker compose up -d && bun run dev`, log in at `http://localhost:3002` as `seller@dev.bibs` / `password123`, open `/store`.

- [ ] **Step 6.1: Bug #1 — clear hours**

Toggle ALL days off → Save (enabled) → success toast → **reload** → all days still off. Then via the API/db confirm `opening_hours IS NULL` (e.g. check the store page openStatus or query the dev DB).

- [ ] **Step 6.2: Bug #3 — no default-hours leak**

With the store now at null hours: reload `/store` → editor shows all days CLOSED (not Mon-Sat 9-13/14:30-19). Edit only the store name → Save → reload → hours STILL null/all-off (defaults not fabricated).

- [ ] **Step 6.3: Bug #4 — post-save disable**

Re-enable some days with valid slots → Save → button becomes DISABLED right after the toast, without remount. Make a new edit → re-enables.

- [ ] **Step 6.4: Bug #5 — no phantom dirty**

Fresh reload of `/store` with no edits → Save is DISABLED (before this fix it was enabled via the websiteUrl phantom dirty).

- [ ] **Step 6.5: Validation UX**

Set a slot `19:00 → 09:00` → inline "L'orario di chiusura deve essere successivo all'apertura" under that day, Save disabled. Set two overlapping slots → overlap message. Fix them → errors clear, Save re-enables.

- [ ] **Step 6.6: Create flow spot-check**

`/store/new`: defaults still seeded (Mon-Sat); toggling all off + submitting must NOT 422 (nullable create body).

- [ ] **Step 6.7: Full verification + PR**

```bash
cd apps/api && bun run test && cd ../..
bun run typecheck && bun run lint
git push -u origin fix/store-opening-hours
```

Open the PR with title: `fix: store opening-hours — clear-on-all-off, default-hours leak, post-save reset, semantic validation`

PR body must cover: the 5 bugs with root causes, the Eden-drops-`undefined` mechanism, why edit seeds `[]` but create keeps defaults, the client/server validator duplication note, and that `getOpenStatus` hardening was deliberately skipped (invalid data can no longer be persisted; dev stage has no legacy rows worth migrating).

---

## Notes & gotchas for the implementer

- **Eden does not serialize `undefined`** — that's the whole bug #1. `null` is the wire format for "clear".
- The PATCH body is INLINE in `routes/stores.ts` (already `t.Nullable`); `CreateStoreBody` in `forms/stores.ts` is the separate one to make nullable.
- `updatedAt` auto-bumps on every `.set()` — don't assert on it in tests.
- Validation errors from TypeBox are **422**; the semantic validator throws **400** via `ServiceError(400, message)` (two-arg only).
- The `biome-ignore` on the re-baseline effect is intentional and load-bearing — adding `openingHours` to the deps array would re-baseline on every edit and kill dirty-detection entirely.
- `closures-manager.tsx` has the same stay-enabled-after-save symptom (same snapshot pattern) — OUT of scope here; it's tracked in the gap analysis (P4), don't fold it in.
