# Apply an Existing Promotion to Products — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a seller apply an existing promotion to one product (row action) or many (bulk action) from the products table, simplify the promotion state taxonomy (badge 5→4, tabs 6→2), and slim the promotion create/edit page by removing the catalog-search picker.

**Architecture:** The discount↔product API already exists and is idempotent (`POST /seller/discounts/:discountId/products`), so this is mostly seller-frontend work plus a small API list-filter change. Adding lives only on the products table; viewing/removing lives only on the promotion page. No DB migration — the stored `discount.status` enum and the `discount_products` join table are untouched.

**Tech Stack:** Elysia + Drizzle + Eden treaty (api), TanStack Router/Query + React + shadcn/@bibs/ui + Paraglide i18n (seller). Tests: `bun test` with testcontainer Postgres.

**Spec:** `docs/superpowers/specs/2026-06-16-apply-promotion-to-products-design.md`

**Branch:** `feat/apply-promotion-to-products` (already created).

---

## File Structure

**Part A — promotion states & tabs**
- Modify: `apps/api/src/lib/schemas/discount.ts` — operational-state union → `assignable | concluded`
- Modify: `apps/api/src/modules/seller/services/discounts.ts` — `DiscountOperationalState` type + `listDiscounts` switch + default
- Modify: `apps/api/src/modules/seller/routes/discounts.ts:54` — description wording
- Modify: `apps/api/tests/integration/seller-discounts.test.ts` — rewrite `listDiscounts` state tests
- Modify: `apps/seller/src/features/promotions/components/promotion-state-badge.tsx` — 4 badge states
- Modify: `apps/seller/src/features/promotions/components/promotion-state-tabs.tsx` — 2 tabs
- Modify: `apps/seller/src/routes/_authenticated/promotions/index.tsx` — validateSearch / EMPTY_MESSAGE / default
- Modify: `apps/seller/messages/{it,en}.json`

**Part B — apply-promotion action**
- Modify: `apps/seller/src/features/promotions/hooks/use-discounts.ts` — `useApplyPromotionToProducts`
- Create: `apps/seller/src/features/products/components/apply-promotion-dialog.tsx`
- Modify: `apps/seller/src/features/products/components/product-row-actions.tsx`
- Modify: `apps/seller/src/features/products/components/product-bulk-toolbar.tsx`
- Modify: `apps/seller/messages/{it,en}.json`

**Part C — slim promotion page**
- Create: `apps/seller/src/features/promotions/components/included-products-list.tsx`
- Modify: `apps/seller/src/routes/_authenticated/promotions/$discountId.tsx`
- Modify: `apps/seller/src/routes/_authenticated/promotions/new.tsx`
- Delete: `apps/seller/src/features/promotions/components/product-selector.tsx`
- Modify: `apps/seller/messages/{it,en}.json`

**Conventions to follow**
- Toast import: `import { toast } from "@bibs/ui/components/sonner"` (never from `sonner`).
- i18n: every user-facing string is a Paraglide message `m.key()`; add to **both** `it.json` and `en.json`.
- The seller alias `@/*` maps to `apps/seller/src/*`.
- Eden hydrates ISO date strings to `Date` objects client-side — handle `string | Date` when formatting.
- Commit message trailer (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

## Part A — Simplify promotion states & tabs

### Task A1: Rewrite the `listDiscounts` filter tests (RED)

**Files:**
- Test: `apps/api/tests/integration/seller-discounts.test.ts:400-479` (the `describe("listDiscounts", …)` block)

- [ ] **Step 1: Replace the two state-filter tests**

In `apps/api/tests/integration/seller-discounts.test.ts`, replace the first two tests inside `describe("listDiscounts", () => {` — i.e. `it("filters by operational state 'running'", …)` and `it("filters 'archived' separately, hidden from 'all'", …)` — with the three tests below. Leave `includes productCount` and `does not leak other sellers' discounts` unchanged (they call `listDiscounts` with no `state`, which now defaults to `assignable`; the fixture default discount is running, hence assignable).

```ts
	it("'assignable' = running + scheduled + paused, excludes expired and archived", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestDiscount(db, seller.profile.id, {
			title: "Running",
			startsAt: new Date(Date.now() - 3600_000),
			endsAt: new Date(Date.now() + 86_400_000),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Scheduled",
			startsAt: new Date(Date.now() + 86_400_000),
			endsAt: new Date(Date.now() + 2 * 86_400_000),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Paused",
			status: "paused",
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Expired",
			startsAt: new Date(Date.now() - 2 * 86_400_000),
			endsAt: new Date(Date.now() - 86_400_000),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Arch",
			status: "archived",
		});

		const res = await listDiscounts({
			sellerProfileId: seller.profile.id,
			state: "assignable",
		});
		expect(res.data.map((d) => d.title).sort()).toEqual([
			"Paused",
			"Running",
			"Scheduled",
		]);
	});

	it("'concluded' = expired + archived only", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestDiscount(db, seller.profile.id, {
			title: "Running",
			startsAt: new Date(Date.now() - 3600_000),
			endsAt: new Date(Date.now() + 86_400_000),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Expired",
			startsAt: new Date(Date.now() - 2 * 86_400_000),
			endsAt: new Date(Date.now() - 86_400_000),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Arch",
			status: "archived",
		});

		const res = await listDiscounts({
			sellerProfileId: seller.profile.id,
			state: "concluded",
		});
		expect(res.data.map((d) => d.title).sort()).toEqual(["Arch", "Expired"]);
	});

	it("a no-end-date running discount is assignable, not concluded", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestDiscount(db, seller.profile.id, {
			title: "Forever",
			startsAt: new Date(Date.now() - 3600_000),
			endsAt: null,
		});

		const assignable = await listDiscounts({
			sellerProfileId: seller.profile.id,
			state: "assignable",
		});
		expect(assignable.data.map((d) => d.title)).toEqual(["Forever"]);

		const concluded = await listDiscounts({
			sellerProfileId: seller.profile.id,
			state: "concluded",
		});
		expect(concluded.data).toHaveLength(0);
	});
```

- [ ] **Step 2: Run the tests to verify they FAIL**

Run: `cd apps/api && bun test tests/integration/seller-discounts.test.ts -t "assignable"`
Expected: FAIL — the current `listDiscounts` switch has no `assignable`/`concluded` cases (they fall through to the `default` = non-archived), so `'concluded'` returns the wrong set. (TypeScript may also flag `state: "assignable"` as not assignable to the current union — that is expected; it goes green in Task A2.)

### Task A2: Implement the new operational-state filter (GREEN)

**Files:**
- Modify: `apps/api/src/lib/schemas/discount.ts:8-18`
- Modify: `apps/api/src/modules/seller/services/discounts.ts:266-314`
- Modify: `apps/api/src/modules/seller/routes/discounts.ts:54-56`

- [ ] **Step 1: Narrow the schema union**

In `apps/api/src/lib/schemas/discount.ts`, replace the `DiscountOperationalStateSchema` definition:

```ts
export const DiscountOperationalStateSchema = t.Union(
	[t.Literal("assignable"), t.Literal("concluded")],
	{
		description:
			"Filtro lista: 'assignable' = in corso/programmate/in pausa; 'concluded' = scadute/archiviate",
	},
);
```

- [ ] **Step 2: Update the service type, default, and switch**

In `apps/api/src/modules/seller/services/discounts.ts`, replace the `DiscountOperationalState` type (around line 266):

```ts
export type DiscountOperationalState = "assignable" | "concluded";
```

Then, inside `listDiscounts`, change the default (around line 284) from `params.state ?? "all"` to:

```ts
	const state = params.state ?? "assignable";
```

And replace the whole `switch (state) { … }` block (lines ~291-314) with:

```ts
	switch (state) {
		case "concluded":
			// Archived, or active-but-past its end date.
			whereParts.push(
				or(
					eq(discount.status, "archived"),
					and(
						eq(discount.status, "active"),
						isNotNull(discount.endsAt),
						lt(discount.endsAt, now),
					),
				)!,
			);
			break;
		default:
			// "assignable": paused, or active and not yet ended (running + scheduled).
			whereParts.push(
				or(
					eq(discount.status, "paused"),
					and(
						eq(discount.status, "active"),
						or(isNull(discount.endsAt), gte(discount.endsAt, now)),
					),
				)!,
			);
			break;
	}
```

- [ ] **Step 3: Fix the drizzle imports**

In the same file's import block (lines 1-14), the new code adds `isNotNull` and stops using `gt` and `lte` (their only uses were the removed `scheduled`/`running` cases). Everything else stays. The exact required set after this change is:

```ts
import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	sql,
} from "drizzle-orm";
```

(Verified against actual usage: `inArray` ×3 and `count` ×4 stay, `sql` stays as a template tag, only `gt` and `lte` are dropped.)

- [ ] **Step 4: Update the route description**

In `apps/api/src/modules/seller/routes/discounts.ts` (around line 54), replace the GET `/discounts` `description` string:

```ts
				description:
					"Elenca le promozioni del venditore. Filtro 'state': 'assignable' (in corso/programmate/in pausa, default) o 'concluded' (scadute/archiviate).",
```

- [ ] **Step 5: Run the new tests + the full discounts suite**

Run: `cd apps/api && bun test tests/integration/seller-discounts.test.ts`
Expected: PASS (all, including the unchanged `productCount` / no-leak tests).

- [ ] **Step 6: Typecheck the api**

Run: `bun run --filter @bibs/api typecheck` (verify exit code is 0 — `echo $?`)
Expected: no errors. If a removed import lingers, fix it.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/schemas/discount.ts apps/api/src/modules/seller/services/discounts.ts apps/api/src/modules/seller/routes/discounts.ts apps/api/tests/integration/seller-discounts.test.ts
git commit -m "feat(api): collapse discount list filter to assignable|concluded

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task A3: Badge — 4 states (`concluded` replaces expired+archived)

**Files:**
- Modify: `apps/seller/src/features/promotions/components/promotion-state-badge.tsx`

- [ ] **Step 1: Update the type, derivation, labels, classes**

Replace the `OperationalState` type, `operationalState()` function, `STATE_LABELS`, and `STATE_CLASSES` so that both "expired" and "archived" collapse to `concluded`:

```ts
export type OperationalState = "running" | "scheduled" | "paused" | "concluded";

export function operationalState(input: Input): OperationalState {
	if (input.status === "archived") return "concluded";
	if (input.status === "paused") return "paused";
	const now = Date.now();
	const startsAt = new Date(input.startsAt).getTime();
	if (now < startsAt) return "scheduled";
	const endsAt = input.endsAt ? new Date(input.endsAt).getTime() : null;
	if (endsAt !== null && now > endsAt) return "concluded";
	return "running";
}

const STATE_LABELS: Record<OperationalState, () => string> = {
	running: m.promotions_state_running,
	scheduled: m.promotions_state_scheduled,
	paused: m.promotions_state_paused,
	concluded: m.promotions_state_concluded,
};

const STATE_CLASSES: Record<OperationalState, string> = {
	running:
		"bg-emerald-50 text-emerald-700 ring-emerald-300/50 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30",
	scheduled:
		"bg-muted text-foreground/70 ring-foreground/10 dark:ring-foreground/20",
	paused:
		"bg-amber-50 text-amber-700 ring-amber-300/50 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30",
	concluded:
		"bg-muted text-muted-foreground ring-foreground/10 dark:ring-foreground/20",
};
```

(The `DiscountStatus` type, `Input`/`Props` interfaces and the JSX render body stay unchanged.)

### Task A4: Tabs — `assignable · concluded`

**Files:**
- Modify: `apps/seller/src/features/promotions/components/promotion-state-tabs.tsx`

- [ ] **Step 1: Replace the type and ORDER**

```ts
export type PromotionState = "assignable" | "concluded";

interface Props {
	value: PromotionState;
	onChange: (v: PromotionState) => void;
}

const ORDER: { value: PromotionState; label: () => string }[] = [
	{ value: "assignable", label: () => m.promotions_tab_active() },
	{ value: "concluded", label: () => m.promotions_tab_concluded() },
];
```

(Leave the `PromotionStateTabs` function body unchanged.)

### Task A5: Promotions list route — search validation, default, empty states

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/promotions/index.tsx`

- [ ] **Step 1: Update `validateSearch` (lines ~34-52)**

```ts
	validateSearch: (search: Record<string, unknown>) => {
		const validStates: readonly PromotionState[] = ["assignable", "concluded"];
		const s = search.state;
		const state: PromotionState = validStates.includes(s as PromotionState)
			? (s as PromotionState)
			: "assignable";
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
			state,
		};
	},
```

- [ ] **Step 2: Replace the `EMPTY_MESSAGE` map (lines ~55-62)**

```ts
const EMPTY_MESSAGE: Record<PromotionState, () => string> = {
	assignable: () => m.promotions_empty_active(),
	concluded: () => m.promotions_empty_concluded(),
};
```

- [ ] **Step 3: Update the empty-state branch (lines ~299-313)**

The rich empty state (with the create CTA) now belongs to the default `assignable` tab:

```tsx
				emptyState={
					state === "assignable" ? (
						<EmptyState
							title={EMPTY_MESSAGE.assignable()}
							description={m.promotions_empty_active_description()}
							action={
								<CreateButton asChild>
									<Link to="/promotions/new">{m.promotions_new_cta()}</Link>
								</CreateButton>
							}
						/>
					) : (
						<EmptyState title={EMPTY_MESSAGE[state]()} />
					)
				}
```

- [ ] **Step 4: Verify no `state: "all"` literals remain in this file**

Run: `grep -n 'state:' apps/seller/src/routes/_authenticated/promotions/index.tsx`
Expected: any default/navigation uses `"assignable"`, none use `"all"`/`"running"`/etc. (The `goToTab` and pagination `navigate` calls spread `prev`, so they need no change.)

### Task A6: Messages for Part A

**Files:**
- Modify: `apps/seller/messages/it.json`
- Modify: `apps/seller/messages/en.json`

- [ ] **Step 1: Add the new keys (both files)**

Add to `it.json` (place near the other `promotions_*` keys):

```json
	"promotions_state_concluded": "Conclusa",
	"promotions_tab_active": "Attive",
	"promotions_tab_concluded": "Concluse",
	"promotions_empty_active": "Nessuna promozione attiva",
	"promotions_empty_active_description": "Crea il tuo primo sconto a percentuale, poi applicalo ai prodotti dalla tabella Prodotti.",
	"promotions_empty_concluded": "Nessuna promozione conclusa",
```

Add the English equivalents to `en.json`:

```json
	"promotions_state_concluded": "Concluded",
	"promotions_tab_active": "Active",
	"promotions_tab_concluded": "Concluded",
	"promotions_empty_active": "No active promotions",
	"promotions_empty_active_description": "Create your first percentage discount, then apply it to products from the Products table.",
	"promotions_empty_concluded": "No concluded promotions",
```

- [ ] **Step 2: Remove keys no longer referenced**

Remove these keys from **both** files (their only consumers were the dropped tabs/states):
`promotions_state_all`, `promotions_state_expired`, `promotions_state_archived`,
`promotions_empty_all`, `promotions_empty_all_description`, `promotions_empty_running`,
`promotions_empty_scheduled`, `promotions_empty_paused`, `promotions_empty_expired`,
`promotions_empty_archived`.

Verify none are still referenced before removing:
Run: `grep -rn "promotions_state_all\|promotions_empty_all\|promotions_state_expired\|promotions_state_archived\|promotions_empty_running\|promotions_empty_scheduled\|promotions_empty_paused\|promotions_empty_expired\|promotions_empty_archived" apps/seller/src`
Expected: no matches (only the JSON message files contain them).

- [ ] **Step 3: Typecheck the seller app (Part A frontend)**

Run: `bun run --filter @bibs/seller typecheck` (check `echo $?`)
Expected: 0 errors. Paraglide regenerates `m` from the JSON on typecheck/build; if `m.promotions_*` is missing, re-run the seller dev/build once to regenerate.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/features/promotions/components/promotion-state-badge.tsx apps/seller/src/features/promotions/components/promotion-state-tabs.tsx apps/seller/src/routes/_authenticated/promotions/index.tsx apps/seller/messages/it.json apps/seller/messages/en.json
git commit -m "feat(seller): promotion badge 4 states + Attive/Concluse tabs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part B — Apply-promotion action (row + bulk)

### Task B1: Mutation hook `useApplyPromotionToProducts`

**Files:**
- Modify: `apps/seller/src/features/promotions/hooks/use-discounts.ts`

- [ ] **Step 1: Append the hook**

Add at the end of `use-discounts.ts` (it already imports `useMutation`, `useQueryClient`, `api`, and defines `DISCOUNTS_KEY`):

```ts
export function useApplyPromotionToProducts() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (vars: { discountId: string; productIds: string[] }) => {
			const res = await api()
				.seller.discounts({ discountId: vars.discountId })
				.products.post({ productIds: vars.productIds });
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: (_data, vars) => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
			void qc.invalidateQueries({
				queryKey: [...DISCOUNTS_KEY, "products", vars.discountId],
			});
		},
	});
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --filter @bibs/seller typecheck` (`echo $?` → 0)
Expected: no errors.

### Task B2: `ApplyPromotionDialog` component

**Files:**
- Create: `apps/seller/src/features/products/components/apply-promotion-dialog.tsx`
- Modify: `apps/seller/messages/{it,en}.json`

- [ ] **Step 1: Add the dialog messages (both files)**

`it.json`:

```json
	"products_apply_promotion_action": "Applica promozione",
	"products_apply_promotion_title": "Applica una promozione a {count} prodotti",
	"products_apply_promotion_subtitle": "Scegli una promozione attiva da applicare.",
	"products_apply_promotion_empty": "Nessuna promozione disponibile.",
	"products_apply_promotion_confirm": "Applica",
	"products_apply_promotion_product_count": "{count} prodotti",
	"products_apply_promotion_success": "{added} prodotti aggiunti a «{title}» ({alreadyPresent} già presenti)",
	"products_apply_promotion_rejected": "{count} prodotti non applicabili",
```

`en.json`:

```json
	"products_apply_promotion_action": "Apply promotion",
	"products_apply_promotion_title": "Apply a promotion to {count} products",
	"products_apply_promotion_subtitle": "Pick an active promotion to apply.",
	"products_apply_promotion_empty": "No promotions available.",
	"products_apply_promotion_confirm": "Apply",
	"products_apply_promotion_product_count": "{count} products",
	"products_apply_promotion_success": "{added} products added to “{title}” ({alreadyPresent} already present)",
	"products_apply_promotion_rejected": "{count} products not applicable",
```

- [ ] **Step 2: Create the component**

`apps/seller/src/features/products/components/apply-promotion-dialog.tsx`:

```tsx
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { RadioGroup, RadioGroupItem } from "@bibs/ui/components/radio-group";
import { ScrollArea } from "@bibs/ui/components/scroll-area";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { cn } from "@bibs/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PromotionStateBadge } from "@/features/promotions/components/promotion-state-badge";
import {
	useApplyPromotionToProducts,
	useDiscountsList,
} from "@/features/promotions/hooks/use-discounts";
import { m } from "@/paraglide/messages";

const PERIOD_FMT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

function fmtPeriod(startsAt: string | Date, endsAt: string | Date | null): string {
	const s = new Date(startsAt).toLocaleDateString("it-IT", PERIOD_FMT);
	const e = endsAt
		? new Date(endsAt).toLocaleDateString("it-IT", PERIOD_FMT)
		: "∞";
	return `${s} → ${e}`;
}

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	productIds: string[];
	onSuccess?: () => void;
}

export function ApplyPromotionDialog({
	open,
	onOpenChange,
	productIds,
	onSuccess,
}: Props) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const list = useDiscountsList({ page: 1, limit: 100, state: "assignable" });
	const apply = useApplyPromotionToProducts();

	// Reset selection on every open (also covers cancel).
	useEffect(() => {
		if (open) setSelectedId(null);
	}, [open]);

	const promotions = list.data?.data ?? [];

	const onApply = () => {
		if (!selectedId) return;
		const promo = promotions.find((p) => p.id === selectedId);
		apply.mutate(
			{ discountId: selectedId, productIds },
			{
				onSuccess: (res) => {
					const r = res.data;
					toast.success(
						m.products_apply_promotion_success({
							added: r.added,
							alreadyPresent: r.alreadyPresent,
							title: promo?.title ?? "",
						}),
					);
					if (r.rejected.length > 0) {
						toast.warning(
							m.products_apply_promotion_rejected({
								count: r.rejected.length,
							}),
						);
					}
					onSuccess?.();
					onOpenChange(false);
				},
				onError: (e) => toast.error((e as Error).message),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{m.products_apply_promotion_title({ count: productIds.length })}
					</DialogTitle>
					<DialogDescription>
						{m.products_apply_promotion_subtitle()}
					</DialogDescription>
				</DialogHeader>

				{list.isLoading ? (
					<div className="flex h-40 items-center justify-center">
						<Spinner className="size-6" />
					</div>
				) : promotions.length === 0 ? (
					<div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
						<p className="text-muted-foreground text-sm">
							{m.products_apply_promotion_empty()}
						</p>
						<Button asChild variant="outline" size="sm">
							<Link to="/promotions/new">{m.promotions_new_cta()}</Link>
						</Button>
					</div>
				) : (
					<ScrollArea className="-mx-1 max-h-72 px-1">
						<RadioGroup
							value={selectedId ?? undefined}
							onValueChange={setSelectedId}
							className="gap-2"
						>
							{promotions.map((p) => (
								<label
									key={p.id}
									htmlFor={`promo-${p.id}`}
									className={cn(
										"flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
										selectedId === p.id
											? "border-primary bg-primary/5"
											: "hover:bg-muted/40",
									)}
								>
									<RadioGroupItem id={`promo-${p.id}`} value={p.id} />
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<span className="truncate font-medium">{p.title}</span>
											<Badge variant="secondary">-{p.percent}%</Badge>
										</div>
										<div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs tabular-nums">
											<span>{fmtPeriod(p.startsAt, p.endsAt)}</span>
											<span>·</span>
											<span>
												{m.products_apply_promotion_product_count({
													count: p.productCount,
												})}
											</span>
										</div>
									</div>
									<PromotionStateBadge
										status={p.status}
										startsAt={p.startsAt}
										endsAt={p.endsAt}
									/>
								</label>
							))}
						</RadioGroup>
					</ScrollArea>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						{m.common_cancel()}
					</Button>
					<Button
						type="button"
						onClick={onApply}
						disabled={!selectedId || apply.isPending}
					>
						{m.products_apply_promotion_confirm()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run --filter @bibs/seller typecheck` (`echo $?` → 0)
Expected: no errors. If `RadioGroup`/`RadioGroupItem` or `ScrollArea` export names differ, open `packages/ui/src/components/radio-group.tsx` and `scroll-area.tsx` and match the actual exports.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/features/promotions/hooks/use-discounts.ts apps/seller/src/features/products/components/apply-promotion-dialog.tsx apps/seller/messages/it.json apps/seller/messages/en.json
git commit -m "feat(seller): ApplyPromotionDialog + apply-to-products mutation hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task B3: Wire the row action

**Files:**
- Modify: `apps/seller/src/features/products/components/product-row-actions.tsx`

- [ ] **Step 1: Import the dialog, the tag icon, and add state**

Add `TagIcon` to the `lucide-react` import. Add the dialog import next to the existing dialog imports:

```ts
import { ApplyPromotionDialog } from "@/features/products/components/apply-promotion-dialog";
```

In the component body, next to `const [addStoreOpen, setAddStoreOpen] = useState(false);` add:

```ts
	const [applyPromoOpen, setApplyPromoOpen] = useState(false);
```

- [ ] **Step 2: Add the menu item (non-trashed only)**

Immediately after the existing "Aggiungi a negozio" `DropdownMenuItem` (the `status !== "trashed"` block that calls `setAddStoreOpen(true)`), add:

```tsx
					{status !== "trashed" && (
						<DropdownMenuItem
							className="whitespace-nowrap"
							onSelect={() => setApplyPromoOpen(true)}
						>
							<TagIcon />
							{m.products_apply_promotion_action()}
						</DropdownMenuItem>
					)}
```

- [ ] **Step 3: Render the dialog**

Next to the existing `<StoreAssignmentDialog … />` at the end of the returned fragment, add:

```tsx
			<ApplyPromotionDialog
				open={applyPromoOpen}
				onOpenChange={setApplyPromoOpen}
				productIds={[productId]}
			/>
```

- [ ] **Step 4: Typecheck**

Run: `bun run --filter @bibs/seller typecheck` (`echo $?` → 0)
Expected: no errors.

### Task B4: Wire the bulk action

**Files:**
- Modify: `apps/seller/src/features/products/components/product-bulk-toolbar.tsx`

- [ ] **Step 1: Import the dialog, the tag icon, add state**

Add `TagIcon` to the `lucide-react` import. Add:

```ts
import { ApplyPromotionDialog } from "@/features/products/components/apply-promotion-dialog";
```

In the body, next to `const [adjustOpen, setAdjustOpen] = useState(false);` add:

```ts
	const [applyPromoOpen, setApplyPromoOpen] = useState(false);
```

- [ ] **Step 2: Add the button to the `active` and `disabled` groups**

In the `statusFilter === "active"` group, add as the first button (before "Adjust Stock"):

```tsx
							<Button
								size="sm"
								variant="outline"
								onClick={() => setApplyPromoOpen(true)}
							>
								<TagIcon className="size-4" />
								{m.products_apply_promotion_action()}
							</Button>
```

In the `statusFilter === "disabled"` group, add the same button as the first child (before "Enable").

- [ ] **Step 3: Render the dialog**

Next to `<BulkStockAdjustDialog … />` at the end, add:

```tsx
			<ApplyPromotionDialog
				open={applyPromoOpen}
				onOpenChange={setApplyPromoOpen}
				productIds={selectedIds}
				onSuccess={onClear}
			/>
```

- [ ] **Step 4: Typecheck**

Run: `bun run --filter @bibs/seller typecheck` (`echo $?` → 0)
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/seller/src/features/products/components/product-row-actions.tsx apps/seller/src/features/products/components/product-bulk-toolbar.tsx
git commit -m "feat(seller): apply-promotion row + bulk actions in products table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part C — Slim the promotion create/edit page

### Task C1: `IncludedProductsList` component

**Files:**
- Create: `apps/seller/src/features/promotions/components/included-products-list.tsx`
- Modify: `apps/seller/messages/{it,en}.json`

- [ ] **Step 1: Add messages (both files)**

`it.json`:

```json
	"promotions_included_empty": "Nessun prodotto in questa promozione.",
	"promotions_included_add_hint": "Aggiungi prodotti dalla tabella Prodotti",
	"promotions_included_remove": "Rimuovi",
```

`en.json`:

```json
	"promotions_included_empty": "No products in this promotion.",
	"promotions_included_add_hint": "Add products from the Products table",
	"promotions_included_remove": "Remove",
```

- [ ] **Step 2: Create the component**

`apps/seller/src/features/promotions/components/included-products-list.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { formatPriceEur } from "@bibs/ui/components/price";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { Link } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";
import {
	useDiscountProducts,
	useRemoveDiscountProducts,
} from "@/features/promotions/hooks/use-discounts";
import { m } from "@/paraglide/messages";

const PAGE_SIZE = 20;

interface Props {
	discountId: string;
}

export function IncludedProductsList({ discountId }: Props) {
	const [page, setPage] = useState(1);
	const query = useDiscountProducts(discountId, page, PAGE_SIZE);
	const remove = useRemoveDiscountProducts(discountId);

	const rows = query.data?.data ?? [];
	const total = query.data?.pagination.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	const onRemove = (productId: string) => {
		remove.mutate([productId], {
			onSuccess: (res) =>
				toast.success(
					m.promotions_toast_products_removed({ count: res.data.removed }),
				),
			onError: (e) => toast.error((e as Error).message),
		});
	};

	if (query.isLoading) {
		return (
			<div className="flex h-48 items-center justify-center">
				<Spinner className="size-6" />
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center">
				<p className="text-muted-foreground text-sm">
					{m.promotions_included_empty()}
				</p>
				<Button asChild variant="link" size="sm">
					<Link to="/products">{m.promotions_included_add_hint()}</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="overflow-hidden rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Nome</TableHead>
							<TableHead className="text-right">Prezzo</TableHead>
							<TableHead className="w-12 pr-4" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.id}>
								<TableCell className="font-medium">{row.name}</TableCell>
								<TableCell className="text-right text-sm tabular-nums">
									<span className="inline-flex items-baseline gap-2">
										<span className="text-muted-foreground line-through">
											{formatPriceEur(row.originalPrice)}
										</span>
										<span className="text-foreground font-semibold">
											{formatPriceEur(row.discountedPrice)}
										</span>
									</span>
								</TableCell>
								<TableCell className="pr-4 text-right">
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={m.promotions_included_remove()}
										disabled={remove.isPending}
										onClick={() => onRemove(row.id)}
									>
										<XIcon className="size-4" />
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<DataPagination
					page={page}
					totalPages={totalPages}
					onPageChange={setPage}
				/>
			)}
		</div>
	);
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run --filter @bibs/seller typecheck` (`echo $?` → 0)
Expected: no errors. If `size="icon-sm"` is not a valid Button size, use `size="icon"`.

### Task C2: Use `IncludedProductsList` on the edit page

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/promotions/$discountId.tsx`

- [ ] **Step 1: Swap the import**

Replace:
```ts
import { ProductSelector } from "@/features/promotions/components/product-selector";
```
with:
```ts
import { IncludedProductsList } from "@/features/promotions/components/included-products-list";
```

- [ ] **Step 2: Replace the selector usage (lines ~158-160)**

Replace:
```tsx
					<ProductSelector
						mode={{ kind: "mutate", discountId, percent: d.percent }}
					/>
```
with:
```tsx
					<IncludedProductsList discountId={discountId} />
```

- [ ] **Step 3: Fix the `onCancel` navigation state (line ~138)**

In the `DiscountForm` `onCancel`, change `state: "all" as const` to `state: "assignable" as const`.

- [ ] **Step 4: Typecheck**

Run: `bun run --filter @bibs/seller typecheck` (`echo $?` → 0)
Expected: no errors.

### Task C3: Slim the create page to a single column

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/promotions/new.tsx`

- [ ] **Step 1: Replace the whole component body**

Replace the contents of `new.tsx` with the version below (drops the `ProductSelector`, the `productIds`/`percent` state, `initialProductIds`, and the `SectionHeader`; collapses to one centered column):

```tsx
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import {
	DiscountForm,
	type DiscountFormValues,
} from "@/features/promotions/components/discount-form";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/promotions/new")({
	component: NewPromotionPage,
});

function NewPromotionPage() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [title, setTitle] = useState<string>("");

	const createMutation = useMutation({
		mutationFn: async (values: DiscountFormValues) => {
			const res = await api().seller.discounts.post({
				title: values.title,
				percent: values.percent,
				startsAt: new Date(values.startsAt),
				endsAt:
					values.noEndDate || !values.endsAt ? null : new Date(values.endsAt),
			});
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data.data;
		},
		onSuccess: (d) => {
			toast.success(m.promotions_toast_created());
			void qc.invalidateQueries({ queryKey: ["discounts"] });
			void navigate({
				to: "/promotions/$discountId",
				params: { discountId: d.id },
			});
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className="mx-auto w-full max-w-2xl space-y-6 p-4 xl:p-6">
			<EntityFormHeader
				mode="create"
				title={title}
				placeholder="Nuova Promozione"
				subtitle="Configura una nuova promozione"
			/>

			<DiscountForm
				submitLabel={m.promotions_form_submit_new()}
				submitting={createMutation.isPending}
				onTitleChange={setTitle}
				onCancel={() =>
					void navigate({
						to: "/promotions",
						search: { page: 1, limit: 20, state: "assignable" as const },
					})
				}
				onSubmit={async (v) => {
					await createMutation.mutateAsync(v);
				}}
			/>
		</div>
	);
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --filter @bibs/seller typecheck` (`echo $?` → 0)
Expected: no errors.

### Task C4: Delete `ProductSelector` and prune its messages

**Files:**
- Delete: `apps/seller/src/features/promotions/components/product-selector.tsx`
- Modify: `apps/seller/src/routes/_authenticated/promotions/$discountId.tsx` (subtitle reword)
- Modify: `apps/seller/messages/{it,en}.json`

- [ ] **Step 1: Confirm there are no remaining importers**

Run: `grep -rn "product-selector\|ProductSelector" apps/seller/src`
Expected: no matches. If any remain, fix them before deleting.

- [ ] **Step 2: Delete the file**

Run: `git rm apps/seller/src/features/promotions/components/product-selector.tsx`

- [ ] **Step 3: Reword the edit-page section subtitle**

The `promotions_section_products_subtitle` text ("Seleziona i prodotti del catalogo…") no longer matches a view+remove panel. Update it in both message files:

`it.json`:
```json
	"promotions_section_products_subtitle": "I prodotti in promozione. Aggiungine altri dalla tabella Prodotti.",
```
`en.json`:
```json
	"promotions_section_products_subtitle": "Products in this promotion. Add more from the Products table.",
```

- [ ] **Step 4: Remove the now-dead selector message keys**

First confirm they're unreferenced in code (only the JSON files should match):
Run: `grep -rn "promotions_selector_\|promotions_toast_products_added" apps/seller/src`
Expected: no matches.

Then remove from **both** `it.json` and `en.json` every key starting with `promotions_selector_` plus `promotions_toast_products_added`. Keep `promotions_toast_products_removed` (used by `IncludedProductsList`) and `promotions_section_products_title`.

- [ ] **Step 5: Typecheck the whole repo**

Run: `bun run typecheck` (root; check `echo $?`)
Expected: 0 errors across all workspaces.

- [ ] **Step 6: Lint the changed files**

Run: `bunx biome check apps/seller/src apps/api/src`
Expected: clean (the Edit/Write hook auto-fixes formatting, but verify no lint errors remain).

- [ ] **Step 7: Commit**

```bash
git add apps/seller/src/routes/_authenticated/promotions/$discountId.tsx apps/seller/src/routes/_authenticated/promotions/new.tsx apps/seller/src/features/promotions/components/included-products-list.tsx apps/seller/messages/it.json apps/seller/messages/en.json
git commit -m "feat(seller): slim promotion page to view+remove, drop ProductSelector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **API tests green**

Run: `cd apps/api && bun test tests/integration/seller-discounts.test.ts tests/modules/seller-discounts-owner-only.test.ts`
Expected: all pass.

- [ ] **Repo typecheck green**

Run: `bun run typecheck` (`echo $?` → 0)

- [ ] **Browser smoke** (seller dev on :3002, login `seller@dev.bibs` / `password123`; ensure at least one *assignable* promotion exists, create one if not)

1. Products table → a row's ⋯ menu → "Applica promozione" → pick a promo → success toast; open that promo's edit page and confirm the product count rose.
2. Tick several rows → bulk toolbar "Applica promozione" → applied to all; selection clears; toast shows the count.
3. Promotion edit page shows the included list (struck original + discounted price); click ✕ on a row → it disappears and the toast confirms removal.
4. `/promotions/new` shows a single-column form with **no** products section; submitting lands on the edit page showing the empty included-list with the "Aggiungi prodotti dalla tabella Prodotti" link.
5. Promotions list shows exactly two tabs **Attive · Concluse** (default Attive); a running, a scheduled and a paused promo all sit under Attive with their distinct row badges; a past-end promo and an archived promo both badge **Conclusa** and live under Concluse.

- [ ] **Finish the branch** via `superpowers:finishing-a-development-branch` (open PR; auto-merge once the 3 required checks are green).
