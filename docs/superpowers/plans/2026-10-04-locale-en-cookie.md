# Locale `en` via cookie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere `en` raggiungibile nei tre FE con la lingua salvata in un cookie: customer completamente in inglese, seller e admin con il selettore solo in dev.

**Architecture:** Paraglide passa da strategia `url` a `["cookie", "baseLocale"]`. Un `src/server.ts` per app avvolge l'handler di TanStack Start con `paraglideMiddleware`, così `getLocale()` è giusto in SSR. Un `LocaleToggle` puro in `packages/ui` sostituisce i due selettori esistenti. Un resolver di locale registrato da ogni app fa seguire la lingua ai formatter condivisi.

**Tech Stack:** TanStack Start 1.168, Paraglide JS 2.25, React 19, Vitest + Testing Library (jsdom nell'admin), Biome.

**Spec:** [`docs/superpowers/specs/2026-10-04-locale-en-cookie-design.md`](../specs/2026-10-04-locale-en-cookie-design.md)

## Global Constraints

- Strategia Paraglide `["cookie", "baseLocale"]` in `vite.base.ts` **e** negli script `paraglide:compile` delle 3 app; niente `url`, niente `preferredLanguage`.
- `locales: ["it", "en"]` in tutte e 3 le `project.inlang/settings.json` (già così: non toccarle).
- `paraglideMiddleware(req, () => handler.fetch(req))`: richiesta originale.
- Mappa locale → Intl: `it` → `it-IT`, `en` → `en-GB`; default `it-IT`. Valuta sempre EUR.
- Etichette lingua nel selettore: «IT» / «EN» visibili, nome nativo («Italiano», «English») in `aria-label`/`title`. Niente bandiere.
- Seller e admin: selettore solo con `import.meta.env.DEV`.
- Ogni chiave Paraglide nuova va in `it.json` **e** `en.json` della stessa app.
- Commit Conventional Commits (`feat|fix|docs|refactor|test|chore`, scope libero: `fe`, `ui`, `customer`, `seller`, `admin`, `docs`), ultima riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Import dei FE: `@/` → `src`, `@bibs/ui/...` per il pacchetto condiviso; dentro `packages/ui` si usa `~/`.
- Test FE: `bun run --filter @bibs/<app> test` (fa `pretest: paraglide:compile`). Suite completa: `bun run test`. Mai `bun test` nudo.

## Review Focus

1. **Cookie assente o con valore non valido** (`PARAGLIDE_LOCALE=fr`): la pagina deve uscire in italiano, non andare in errore → curl in Task 1 con cookie invalido.
2. **SSR con richieste concorrenti in lingue diverse**: il resolver dei formatter deve leggere la locale a ogni chiamata, mai una volta sola al caricamento del modulo → test in Task 2 che cambia resolver tra due chiamate.
3. **Formatter con istanze in cache**: una cache per locale non deve restituire il formatter dell'altra lingua → test in Task 2 su `formatPriceEur` it ↔ en ↔ it.
4. **Selettore con una sola locale** (o `locales` vuoto): non deve renderizzare un vassoio inutile → test in Task 3.
5. **Hydration mismatch** sul `lang` e sui testi: server e client devono risolvere la stessa locale (cookie letto da entrambi) → verifica in console in Task 7 (nessun warning di hydration dopo il cambio lingua).

---

### Task 1: Strategia cookie, middleware SSR e `lang` (3 app)

**Files:**
- Modify: `vite.base.ts:38-42`
- Modify: `apps/customer/package.json:13`, `apps/seller/package.json:13`, `apps/admin/package.json:12` (script `paraglide:compile`)
- Create: `apps/customer/src/server.ts`, `apps/seller/src/server.ts`, `apps/admin/src/server.ts`
- Modify: `apps/{customer,seller,admin}/src/routes/__root.tsx` (via `beforeLoad`)

**Interfaces:**
- Produces: `getLocale()` corretto in SSR in tutte e 3 le app; `setLocale(l)` scrive il cookie `PARAGLIDE_LOCALE` e ricarica.

- [ ] **Step 1: Cambia la strategia nel plugin Vite**

In `vite.base.ts`:

```ts
			paraglideVitePlugin({
				project: "./project.inlang",
				outdir: "./src/paraglide",
				strategy: ["cookie", "baseLocale"],
			}),
```

- [ ] **Step 2: Allinea gli script di compilazione**

In ciascuno dei 3 `package.json`, sostituisci `--strategy url baseLocale` con `--strategy cookie baseLocale`:

```json
"paraglide:compile": "paraglide-js compile --project ./project.inlang --outdir ./src/paraglide --strategy cookie baseLocale",
```

Poi ricompila e verifica:

Run: `for a in customer seller admin; do (cd apps/$a && bun run paraglide:compile) && grep -A3 "export const strategy" apps/$a/src/paraglide/runtime.js; done`
Expected: per ogni app `"cookie",` e `"baseLocale"` nell'array, niente `"url"`.

- [ ] **Step 3: Crea `src/server.ts` in ognuna delle 3 app** (contenuto identico)

```ts
import handler from "@tanstack/react-start/server-entry";
import { paraglideMiddleware } from "./paraglide/server.js";

/**
 * Entry server di TanStack Start avvolto da Paraglide: il middleware legge il
 * cookie della lingua e la tiene in AsyncLocalStorage per tutto il render,
 * così `getLocale()` (e `<html lang>`) è quello della richiesta già in SSR.
 * Con la strategia cookie non riscrive l'URL: si passa la richiesta originale.
 */
export default {
	fetch(req: Request): Promise<Response> {
		return paraglideMiddleware(req, () => handler.fetch(req));
	},
};
```

- [ ] **Step 4: Togli il `beforeLoad` del lang dai 3 `__root.tsx`**

Elimina questo blocco (righe ~26-30) in ciascun `__root.tsx`:

```ts
	beforeLoad: async () => {
		if (typeof document !== "undefined") {
			document.documentElement.setAttribute("lang", getLocale());
		}
	},
```

`getLocale` resta importato: lo usa `<html lang={getLocale()}>`.

- [ ] **Step 5: Typecheck**

Run: `bun run --filter @bibs/customer typecheck && bun run --filter @bibs/seller typecheck && bun run --filter @bibs/admin typecheck`
Expected: exit 0 per ciascuna (controlla ogni workspace: l'aggregato può nascondere un fallimento).

- [ ] **Step 6: Verifica SSR con curl**

Avvia i dev server (`bun run dev` dalla root, o per app) e, per ogni porta 3001, 3002, 3003:

```bash
for p in 3001 3002 3003; do
  echo "== $p"
  curl -s localhost:$p/login | grep -o '<html[^>]*>'
  curl -s -H 'Cookie: PARAGLIDE_LOCALE=en' localhost:$p/login | grep -o '<html[^>]*>'
  curl -s -H 'Cookie: PARAGLIDE_LOCALE=fr' -o /dev/null -w '%{http_code}\n' localhost:$p/login
  curl -s -H 'Cookie: PARAGLIDE_LOCALE=fr' localhost:$p/login | grep -o '<html[^>]*>'
done
```

Expected per ogni porta: `lang="it"`, poi `lang="en"`, poi `200`, poi `lang="it"`. Sul 3001 con cookie `en`: `curl -s -H 'Cookie: PARAGLIDE_LOCALE=en' localhost:3001/login | grep -c "Sign in with your credentials"` → `1` o più.

- [ ] **Step 7: Commit**

```bash
git add vite.base.ts apps/*/package.json apps/*/src/server.ts apps/*/src/routes/__root.tsx
git commit -m "feat(fe): lingua nel cookie e middleware Paraglide in SSR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Formattazione che segue la lingua (`packages/ui`)

**Files:**
- Create: `packages/ui/src/lib/intl-locale.ts`
- Modify: `packages/ui/src/custom/price.tsx:5-19`
- Modify: `packages/ui/src/lib/date.ts:25-37` (`formatDateIt` → `formatDate`)
- Modify (rinomina import/uso): `apps/admin/src/features/crud/category-crud-panel.tsx`, `apps/admin/src/routes/_authenticated/users.tsx`, `apps/admin/src/routes/_authenticated/sellers/index.tsx`, `apps/seller/src/routes/_authenticated/products/index.tsx`, `apps/seller/src/routes/_authenticated/team/index.tsx`
- Modify: `apps/{customer,seller,admin}/src/router.tsx` (registrazione del resolver)
- Test: `apps/customer/src/lib/intl-locale.test.ts`

**Interfaces:**
- Produces (in `@bibs/ui/lib/intl-locale`):
  - `intlLocaleFor(locale: string): string` — `"en"` → `"en-GB"`, tutto il resto → `"it-IT"`
  - `setIntlLocaleResolver(resolve: () => string): void`
  - `intlLocale(): string` — chiama il resolver; default `"it-IT"`
- Produces: `formatPriceEur(value: string | number): string` (firma invariata), `formatDate(value: string | Date, opts?: { long?: boolean }): string`.

- [ ] **Step 1: Scrivi il test che fallisce**

`apps/customer/src/lib/intl-locale.test.ts`:

```ts
import { formatPriceEur } from "@bibs/ui/custom/price";
import { formatDate } from "@bibs/ui/lib/date";
import {
	intlLocale,
	intlLocaleFor,
	setIntlLocaleResolver,
} from "@bibs/ui/lib/intl-locale";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => setIntlLocaleResolver(() => "it-IT"));

describe("intlLocaleFor", () => {
	it("maps en to en-GB and everything else to it-IT", () => {
		expect(intlLocaleFor("en")).toBe("en-GB");
		expect(intlLocaleFor("it")).toBe("it-IT");
		expect(intlLocaleFor("fr")).toBe("it-IT");
	});
});

describe("intlLocale", () => {
	it("reads the resolver on every call, never once at load", () => {
		let current = "it-IT";
		setIntlLocaleResolver(() => current);
		expect(intlLocale()).toBe("it-IT");
		current = "en-GB";
		expect(intlLocale()).toBe("en-GB");
	});
});

describe("formatPriceEur", () => {
	it("follows the locale and never reuses the other language's formatter", () => {
		setIntlLocaleResolver(() => "it-IT");
		expect(formatPriceEur(1234.5)).toBe("1234,50 €");
		setIntlLocaleResolver(() => "en-GB");
		expect(formatPriceEur("1234.5")).toBe("€1,234.50");
		setIntlLocaleResolver(() => "it-IT");
		expect(formatPriceEur(9.99)).toBe("9,99 €");
	});

	it("still renders a dash for non-finite values", () => {
		expect(formatPriceEur("abc")).toBe("—");
	});
});

describe("formatDate", () => {
	it("follows the locale", () => {
		setIntlLocaleResolver(() => "it-IT");
		expect(formatDate("2026-10-04T12:00:00Z", { long: true })).toBe(
			"4 ottobre 2026",
		);
		setIntlLocaleResolver(() => "en-GB");
		expect(formatDate("2026-10-04T12:00:00Z", { long: true })).toBe(
			"4 October 2026",
		);
	});
});
```

Nota: `it-IT` non mette il separatore delle migliaia sotto 10.000 (`1234,50 €`, verificato con ICU di Node): è la regola CLDR, non un errore.

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `bun run --filter @bibs/customer test -- src/lib/intl-locale.test.ts`
Expected: FAIL, modulo `@bibs/ui/lib/intl-locale` non trovato.

- [ ] **Step 3: Crea `packages/ui/src/lib/intl-locale.ts`**

```ts
/**
 * Locale Intl per i formatter condivisi. `packages/ui` non può importare il
 * runtime Paraglide delle app, quindi ogni app registra un resolver (in
 * `router.tsx`) che legge `getLocale()` a ogni chiamata: in SSR quella della
 * richiesta corrente, anche con richieste concorrenti in lingue diverse.
 */
const INTL_LOCALES: Record<string, string> = { it: "it-IT", en: "en-GB" };
const DEFAULT_INTL_LOCALE = "it-IT";

let resolver: () => string = () => DEFAULT_INTL_LOCALE;

/** Locale Paraglide → tag Intl ("en" → "en-GB"); ignote → "it-IT". */
export function intlLocaleFor(locale: string): string {
	return INTL_LOCALES[locale] ?? DEFAULT_INTL_LOCALE;
}

export function setIntlLocaleResolver(resolve: () => string): void {
	resolver = resolve;
}

/** Il tag Intl della lingua corrente. */
export function intlLocale(): string {
	return resolver();
}
```

- [ ] **Step 4: `formatPriceEur` per lingua** (`packages/ui/src/custom/price.tsx`)

Sostituisci `EUR_FORMATTER` e la funzione con:

```ts
import { intlLocale } from "~/lib/intl-locale";

const EUR_FORMATTERS = new Map<string, Intl.NumberFormat>();

function eurFormatter(locale: string): Intl.NumberFormat {
	let formatter = EUR_FORMATTERS.get(locale);
	if (!formatter) {
		formatter = new Intl.NumberFormat(locale, {
			style: "currency",
			currency: "EUR",
		});
		EUR_FORMATTERS.set(locale, formatter);
	}
	return formatter;
}

/**
 * Formatta un prezzo EUR nella lingua dell'utente: "9,99 €" in italiano,
 * "€9.99" in inglese. Accetta string (es. "9.99" dall'API) o number. Valori
 * non finiti → "—".
 */
export function formatPriceEur(value: string | number): string {
	const n = typeof value === "string" ? Number.parseFloat(value) : value;
	if (!Number.isFinite(n)) return "—";
	return eurFormatter(intlLocale()).format(n);
}
```

(L'import va in testa al file con gli altri.)

- [ ] **Step 5: `formatDateIt` → `formatDate`** (`packages/ui/src/lib/date.ts`)

```ts
import { intlLocale } from "~/lib/intl-locale";

/**
 * Formatta una data nella lingua dell'utente ("3 mar 2026" / "3 Mar 2026").
 * `long` usa il mese per esteso (default: mese abbreviato). Accetta una string
 * o una Date.
 */
export function formatDate(
	value: string | Date,
	{ long = false }: { long?: boolean } = {},
): string {
	return new Date(value).toLocaleDateString(intlLocale(), {
		year: "numeric",
		month: long ? "long" : "short",
		day: "numeric",
	});
}
```

Poi rinomina gli usi:

Run: `grep -rl "formatDateIt" apps/*/src packages/ui/src | xargs sed -i '' 's/formatDateIt/formatDate/g' && grep -rn "formatDateIt" apps/*/src packages/ui/src`
Expected: nessun risultato dal secondo grep.

- [ ] **Step 6: Registra il resolver nei 3 `router.tsx`** (identico)

```ts
import { getContext } from "@bibs/ui/integrations/tanstack-query/root-provider";
import { intlLocaleFor, setIntlLocaleResolver } from "@bibs/ui/lib/intl-locale";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { getLocale } from "./paraglide/runtime";
import { routeTree } from "./routeTree.gen";

// I formatter di @bibs/ui seguono la lingua Paraglide di questa app.
setIntlLocaleResolver(() => intlLocaleFor(getLocale()));
```

(il resto del file invariato).

- [ ] **Step 7: Esegui i test**

Run: `bun run --filter @bibs/customer test -- src/lib/intl-locale.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck delle 3 app e commit**

Run: `bun run --filter @bibs/ui typecheck && bun run --filter @bibs/customer typecheck && bun run --filter @bibs/seller typecheck && bun run --filter @bibs/admin typecheck`
Expected: exit 0 per ciascuna.

```bash
git add packages/ui/src/lib/intl-locale.ts packages/ui/src/custom/price.tsx packages/ui/src/lib/date.ts apps/*/src/router.tsx apps/customer/src/lib/intl-locale.test.ts apps/admin/src apps/seller/src
git commit -m "feat(ui): prezzi e date nella lingua dell'utente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `LocaleToggle` condiviso

**Files:**
- Create: `packages/ui/src/custom/locale-toggle.tsx`
- Test: `apps/admin/src/components/locale-toggle.test.tsx` (l'admin ha jsdom e Testing Library, come `tab-nav.test.tsx`)

**Interfaces:**
- Produces (in `@bibs/ui/custom/locale-toggle`):

```ts
export function LocaleToggle<L extends string>(props: {
	locales: readonly L[];
	value: L;
	onChange: (locale: L) => void;
	/** Etichetta della riga, già tradotta ("Lingua" / "Language"). */
	label: string;
	className?: string;
}): JSX.Element | null;
```

Nota rispetto alla spec: i nomi delle lingue sono **nativi** («Italiano», «English») e non si traducono, quindi stanno in una costante del componente invece che in `labels.names`; resta solo `label`.

- [ ] **Step 1: Scrivi il test che fallisce**

`apps/admin/src/components/locale-toggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { LocaleToggle } from "@bibs/ui/custom/locale-toggle";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("LocaleToggle", () => {
	it("renders nothing with a single locale", () => {
		const { container } = render(
			<LocaleToggle locales={["it"]} value="it" onChange={() => {}} label="Lingua" />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing with no locales", () => {
		const { container } = render(
			<LocaleToggle locales={[]} value="it" onChange={() => {}} label="Lingua" />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("shows short codes with native names as accessible labels", () => {
		render(
			<LocaleToggle locales={["it", "en"]} value="it" onChange={() => {}} label="Lingua" />,
		);
		expect(screen.getByRole("group", { name: "Lingua" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Italiano" }).textContent).toBe("IT");
		expect(screen.getByRole("radio", { name: "English" }).textContent).toBe("EN");
	});

	it("calls onChange with the picked locale, not with the current one", () => {
		const onChange = vi.fn();
		render(
			<LocaleToggle locales={["it", "en"]} value="it" onChange={onChange} label="Lingua" />,
		);
		fireEvent.click(screen.getByRole("radio", { name: "English" }));
		expect(onChange).toHaveBeenCalledWith("en");
		fireEvent.click(screen.getByRole("radio", { name: "Italiano" }));
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});
```

Se il `ToggleGroup` di `packages/ui` espone i suoi item come `button` con `aria-pressed` invece di `radio`, adegua i `getByRole` a `"button"` (controlla con `screen.debug()`); il comportamento atteso non cambia.

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `bun run --filter @bibs/admin test -- src/components/locale-toggle.test.tsx`
Expected: FAIL, modulo `@bibs/ui/custom/locale-toggle` non trovato.

- [ ] **Step 3: Crea `packages/ui/src/custom/locale-toggle.tsx`**

```tsx
"use client";

import { ToggleGroup, ToggleGroupItem } from "~/components/toggle-group";
import {
	segmentedTrayClassName,
	segmentedTrayItemClassName,
} from "~/custom/theme-toggle";
import { cn } from "~/lib/utils";

/** Nome di ogni lingua nella lingua stessa: non si traduce. */
const NATIVE_NAMES: Record<string, string> = {
	it: "Italiano",
	en: "English",
};

interface LocaleToggleProps<L extends string> {
	locales: readonly L[];
	value: L;
	onChange: (locale: L) => void;
	/** Etichetta della riga, già tradotta ("Lingua" / "Language"). */
	label: string;
	className?: string;
}

/**
 * Riga "Lingua" con vassoio segmentato IT / EN, gemella di `ThemeToggle`
 * (stesso vassoio, è un `<div>` così non chiude il menu che la ospita). Il
 * runtime Paraglide è di ogni app: il componente riceve locale e callback.
 * Con una sola lingua non c'è niente da scegliere e non renderizza nulla.
 */
export function LocaleToggle<L extends string>({
	locales,
	value,
	onChange,
	label,
	className,
}: LocaleToggleProps<L>) {
	if (locales.length < 2) return null;

	return (
		<div
			className={cn(
				"flex items-center justify-between gap-3 px-2 py-1",
				className,
			)}
		>
			<span className="font-medium text-muted-foreground text-xs">{label}</span>
			<ToggleGroup
				type="single"
				value={value}
				onValueChange={(next) => {
					if (!next || next === value) return;
					onChange(next as L);
				}}
				size="sm"
				spacing={1}
				aria-label={label}
				className={segmentedTrayClassName}
			>
				{locales.map((locale) => {
					const name = NATIVE_NAMES[locale] ?? locale.toUpperCase();
					return (
						<ToggleGroupItem
							key={locale}
							value={locale}
							aria-label={name}
							title={name}
							className={cn(
								"px-2 font-medium text-xs",
								segmentedTrayItemClassName,
							)}
						>
							{locale.toUpperCase()}
						</ToggleGroupItem>
					);
				})}
			</ToggleGroup>
		</div>
	);
}
```

- [ ] **Step 4: Esegui i test**

Run: `bun run --filter @bibs/admin test -- src/components/locale-toggle.test.tsx`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/custom/locale-toggle.tsx apps/admin/src/components/locale-toggle.test.tsx
git commit -m "feat(ui): LocaleToggle condiviso, gemello di ThemeToggle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Selettore nelle tre app

**Files:**
- Create: `apps/customer/src/components/locale-select.tsx`
- Create: `apps/customer/src/components/auth-locale-footer.tsx`
- Modify: `apps/customer/src/components/user-menu.tsx:64-66`
- Modify: `apps/customer/src/routes/{login,register,forgot-password,reset-password,verify-email}.tsx` (wrapper della card)
- Create: `apps/seller/src/components/locale-select.tsx`
- Modify: `apps/seller/src/components/nav-user.tsx` (via `LOCALE_FLAGS`, `LOCALE_NAMES`, blocco `ToggleGroup` 121-150, import ToggleGroup/runtime se non più usati)
- Create: `apps/admin/src/components/locale-select.tsx`
- Modify: `apps/admin/src/components/nav-user.tsx:20,67-72`
- Delete: `apps/admin/src/components/locale-switcher.tsx`

**Interfaces:**
- Consumes: `LocaleToggle` (Task 3); `setLocale`, `getLocale`, `locales` dal runtime Paraglide di ogni app; `m.language_label()` (esiste in tutte e 3 le app).
- Produces: `LocaleSelect()` per app, senza props.

- [ ] **Step 1: `LocaleSelect` del customer** (`apps/customer/src/components/locale-select.tsx`)

```tsx
import { LocaleToggle } from "@bibs/ui/custom/locale-toggle";
import { m } from "@/paraglide/messages";
import { getLocale, locales, setLocale } from "@/paraglide/runtime";

/** Selettore lingua: scrive il cookie Paraglide e ricarica la pagina. */
export function LocaleSelect({ className }: { className?: string }) {
	return (
		<LocaleToggle
			locales={locales}
			value={getLocale()}
			onChange={(locale) => setLocale(locale)}
			label={m.language_label()}
			className={className}
		/>
	);
}
```

- [ ] **Step 2: Nel menu utente del customer**

In `apps/customer/src/components/user-menu.tsx`, subito dopo `<ThemeToggle />` (prima del `DropdownMenuSeparator` che precede il logout):

```tsx
				<ThemeToggle />
				<LocaleSelect />
```

con `import { LocaleSelect } from "@/components/locale-select";`.

- [ ] **Step 3: Footer lingua delle pagine auth** (`apps/customer/src/components/auth-locale-footer.tsx`)

```tsx
import { LocaleSelect } from "@/components/locale-select";

/** Lingua sulle pagine senza login, dove il menu utente non c'è. */
export function AuthLocaleFooter() {
	return <LocaleSelect className="w-full max-w-sm px-0" />;
}
```

In ognuna delle 5 pagine (`login`, `register`, `forgot-password`, `reset-password`, `verify-email`) il wrapper della card diventa una colonna e il footer segue la `</Card>`:

```tsx
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
			<Card className="w-full max-w-sm">
				{/* … invariato … */}
			</Card>
			<AuthLocaleFooter />
		</div>
```

con `import { AuthLocaleFooter } from "@/components/auth-locale-footer";`. In `verify-email.tsx` c'è un secondo `return` a riga ~36 (stato di caricamento/redirect): tocca solo quello con la `Card` (riga ~65).

- [ ] **Step 4: `LocaleSelect` di seller e admin** (stesso file in `apps/seller/src/components/locale-select.tsx` e `apps/admin/src/components/locale-select.tsx`)

```tsx
import { LocaleToggle } from "@bibs/ui/custom/locale-toggle";
import { m } from "@/paraglide/messages";
import { getLocale, locales, setLocale } from "@/paraglide/runtime";

/**
 * Selettore lingua, per ora solo in dev: l'inglese di questa app non è ancora
 * tradotto (vedi P4 nell'audit). Serve a provare le PR di traduzione; nelle
 * build di produzione non c'è.
 */
export function LocaleSelect() {
	if (!import.meta.env.DEV) return null;
	return (
		<LocaleToggle
			locales={locales}
			value={getLocale()}
			onChange={(locale) => setLocale(locale)}
			label={m.language_label()}
		/>
	);
}
```

- [ ] **Step 5: Seller, `nav-user.tsx`**

Sostituisci il blocco

```tsx
						<div className="flex flex-col gap-1 py-1">
							<ThemeToggle />
							<div className="flex items-center justify-between gap-3 px-2 py-1">
								…ToggleGroup a bandierine…
							</div>
						</div>
```

con

```tsx
						<div className="flex flex-col gap-1 py-1">
							<ThemeToggle />
							<LocaleSelect />
						</div>
```

Rimuovi `LOCALE_FLAGS`, `LOCALE_NAMES`, `const currentLocale = getLocale()`, l'import da `@/paraglide/runtime`, `segmentedTrayClassName`/`segmentedTrayItemClassName` e `ToggleGroup`/`ToggleGroupItem` se non più usati altrove nel file (Biome/TS li segnala). Aggiungi `import { LocaleSelect } from "@/components/locale-select";`.

- [ ] **Step 6: Admin, `nav-user.tsx`**

```tsx
						<DropdownMenuGroup>
							<ThemeToggle />
							<LocaleSelect />
						</DropdownMenuGroup>
```

Import: `import { LocaleSelect } from "@/components/locale-select";` al posto di `LocaleSwitcher`. Poi:

Run: `git rm apps/admin/src/components/locale-switcher.tsx && grep -rn "locale-switcher\|LocaleSwitcher" apps/admin/src`
Expected: nessun risultato dal grep.

- [ ] **Step 7: Typecheck e test delle 3 app**

Run: `for a in customer seller admin; do bun run --filter @bibs/$a typecheck && bun run --filter @bibs/$a test || echo "FAIL $a"; done`
Expected: nessun `FAIL`.

- [ ] **Step 8: Commit**

```bash
git add apps/customer/src apps/seller/src apps/admin/src
git commit -m "feat(fe): selettore lingua nel menu utente e sulle pagine auth

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Etichette di `ThemeToggle` e `PasswordInput`, stringhe residue del customer

**Files:**
- Modify: `packages/ui/src/custom/theme-toggle.tsx:74-131`
- Modify: `packages/ui/src/custom/password-input.tsx`
- Modify: `apps/customer/src/components/user-menu.tsx` (labels al `ThemeToggle`)
- Modify: `apps/customer/src/routes/{login,register,reset-password}.tsx` (labels a `PasswordInput`)
- Modify: `apps/customer/src/routes/__root.tsx` (`NotFound`)
- Modify: `apps/customer/src/features/stores/store-cover.tsx:67`
- Modify: `apps/customer/src/features/stores/open-status.ts`
- Modify: `apps/customer/src/features/stores/open-status.test.ts`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Produces: `ThemeToggle` prop `labels?: { light: string; dark: string; system: string }` (oltre a `label` esistente); `PasswordInput` prop `labels?: { show: string; hide: string }`. Default: l'italiano attuale.

- [ ] **Step 1: Chiavi Paraglide del customer**

In `apps/customer/messages/it.json` (prima della `}` finale; tieni la virgola sulla riga precedente):

```json
	"theme_label": "Aspetto",
	"theme_light": "Chiaro",
	"theme_dark": "Scuro",
	"theme_system": "Sistema",
	"password_show": "Mostra password",
	"password_hide": "Nascondi password",
	"not_found_title": "Pagina non trovata",
	"not_found_home": "Torna alla home",
	"open_status_unknown": "Orari non indicati",
	"open_status_open": "Aperto",
	"open_status_open_closes": "Aperto · chiude alle {time}",
	"open_status_closed": "Chiuso",
	"open_status_closed_opens": "Chiuso · {opens}",
	"opens_today": "apre alle {time}",
	"opens_tomorrow": "apre domani alle {time}",
	"opens_on": "apre {day} alle {time}"
```

In `apps/customer/messages/en.json`:

```json
	"theme_label": "Appearance",
	"theme_light": "Light",
	"theme_dark": "Dark",
	"theme_system": "System",
	"password_show": "Show password",
	"password_hide": "Hide password",
	"not_found_title": "Page not found",
	"not_found_home": "Back to home",
	"open_status_unknown": "Hours not listed",
	"open_status_open": "Open",
	"open_status_open_closes": "Open · closes at {time}",
	"open_status_closed": "Closed",
	"open_status_closed_opens": "Closed · {opens}",
	"opens_today": "opens at {time}",
	"opens_tomorrow": "opens tomorrow at {time}",
	"opens_on": "opens {day} at {time}"
```

«Negozi» della copertina usa la chiave esistente `nav_stores`.

- [ ] **Step 2: Aggiorna il test di `open-status` (prima fallisce)**

In `apps/customer/src/features/stores/open-status.test.ts` aggiungi in fondo:

```ts
import { overwriteGetLocale } from "@/paraglide/runtime";

describe("openStatusLabel in English", () => {
	it("translates every state", () => {
		overwriteGetLocale(() => "en");
		try {
			expect(openStatusLabel({ isOpen: false, status: "unknown" })).toBe(
				"Hours not listed",
			);
			expect(openStatusLabel({ isOpen: false, status: "closed" })).toBe("Closed");
			expect(
				openStatusLabel({ isOpen: true, status: "open", closesAt: "19:30" }),
			).toBe("Open · closes at 19:30");
			expect(
				openStatusLabel({
					isOpen: false,
					status: "closed",
					opensAt: { date: "2999-01-01", time: "08:30" },
				}),
			).toMatch(/^Closed · opens .+ at 08:30$/);
		} finally {
			overwriteGetLocale(() => "it");
		}
	});
});
```

(sposta l'import in testa al file con gli altri). I test italiani esistenti restano invariati.

Run: `bun run --filter @bibs/customer test -- src/features/stores/open-status.test.ts`
Expected: FAIL sul blocco inglese (le stringhe sono ancora hardcoded).

- [ ] **Step 3: `open-status.ts` su Paraglide**

```ts
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { Clock, HelpCircle, type LucideIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
```

`describeOpensAt`:

```ts
	if (opensAt.date === todayRome) return m.opens_today({ time: opensAt.time });
	if (opensAt.date === fmt(tomorrow))
		return m.opens_tomorrow({ time: opensAt.time });
	const d = new Date(`${opensAt.date}T00:00:00`);
	const day = new Intl.DateTimeFormat(intlLocale(), {
		weekday: "short",
		day: "numeric",
		month: "short",
	}).format(d);
	return m.opens_on({ day, time: opensAt.time });
```

`openStatusLabel`:

```ts
	if (status.status === "unknown") return m.open_status_unknown();
	if (status.isOpen) {
		return status.closesAt
			? m.open_status_open_closes({ time: status.closesAt })
			: m.open_status_open();
	}
	if (status.opensAt)
		return m.open_status_closed_opens({ opens: describeOpensAt(status.opensAt) });
	return m.open_status_closed();
```

Il formatter `en-CA` resta: calcola solo la data di oggi, non si mostra.

Nota: nel test, `intlLocale()` usa il resolver di default (`it-IT`) perché `router.tsx` non viene caricato, quindi il giorno resta in italiano anche col blocco inglese: per questo l'atteso è `/^Closed · opens .+ at 08:30$/`.

Run: `bun run --filter @bibs/customer test -- src/features/stores/open-status.test.ts`
Expected: PASS.

- [ ] **Step 4: Prop `labels` su `ThemeToggle`** (`packages/ui/src/custom/theme-toggle.tsx`)

```ts
interface ThemeToggleProps {
	/** Etichetta della riga (default "Aspetto"). */
	label?: string;
	/** Nomi accessibili delle tre modalità (default in italiano). */
	labels?: { light: string; dark: string; system: string };
	className?: string;
}

const DEFAULT_LABELS = { light: "Chiaro", dark: "Scuro", system: "Sistema" };
```

Firma: `export function ThemeToggle({ label = "Aspetto", labels = DEFAULT_LABELS, className }: ThemeToggleProps)` e nei tre item `aria-label={labels.light}`, `aria-label={labels.dark}`, `aria-label={labels.system}`.

Nel customer (`user-menu.tsx`):

```tsx
				<ThemeToggle
					label={m.theme_label()}
					labels={{
						light: m.theme_light(),
						dark: m.theme_dark(),
						system: m.theme_system(),
					}}
				/>
```

- [ ] **Step 5: Prop `labels` su `PasswordInput`** (`packages/ui/src/custom/password-input.tsx`)

```tsx
type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
	/** Nomi accessibili del bottone mostra/nascondi (default in italiano). */
	labels?: { show: string; hide: string };
};

const DEFAULT_LABELS = { show: "Mostra password", hide: "Nascondi password" };

export function PasswordInput({
	className,
	labels = DEFAULT_LABELS,
	...props
}: PasswordInputProps) {
```

e `aria-label={showPassword ? labels.hide : labels.show}`.

Nel customer, a ogni `<PasswordInput` di `login.tsx`, `register.tsx`, `reset-password.tsx` aggiungi:

```tsx
					labels={{ show: m.password_show(), hide: m.password_hide() }}
```

Run: `grep -c "<PasswordInput" apps/customer/src/routes/{login,register,reset-password}.tsx; grep -c "password_show" apps/customer/src/routes/{login,register,reset-password}.tsx`
Expected: i due conteggi coincidono file per file.

- [ ] **Step 6: `NotFound` e copertina**

`apps/customer/src/routes/__root.tsx`, con `import { m } from "@/paraglide/messages";`:

```tsx
			<p className="text-muted-foreground">{m.not_found_title()}</p>
			<Link to="/" className="text-primary underline">
				{m.not_found_home()}
			</Link>
```

`apps/customer/src/features/stores/store-cover.tsx:67`: `Negozi` → `{m.nav_stores()}` (aggiungi l'import di `m` se manca).

- [ ] **Step 7: Verifica che non resti italiano visibile nel customer**

Run: `grep -rn '"Pagina non trovata\|Torna alla home\|>\s*Negozi\s*<\|Orari non indicati\|"Aperto\|"Chiuso' apps/customer/src --include='*.ts' --include='*.tsx' | grep -v "\.test\.\|src/paraglide/"`
Expected: nessun risultato.

- [ ] **Step 8: Test, typecheck, commit**

Run: `for a in customer seller admin; do bun run --filter @bibs/$a typecheck && bun run --filter @bibs/$a test || echo "FAIL $a"; done`
Expected: nessun `FAIL`.

```bash
git add packages/ui/src/custom/theme-toggle.tsx packages/ui/src/custom/password-input.tsx apps/customer
git commit -m "feat(customer): ultime stringhe su Paraglide, etichette di tema e password tradotte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Date e numeri del customer nella lingua dell'utente

**Files:**
- Modify: `apps/customer/src/features/products/format-characteristic.ts:15,38`
- Modify: `apps/customer/src/features/orders/order-display.ts:43`
- Modify: `apps/customer/src/routes/_authenticated/points.tsx:149`
- Modify: `apps/customer/src/routes/_authenticated/orders/index.tsx:132-133`
- Modify: `apps/customer/src/routes/_authenticated/orders/$orderId.tsx:91`
- Modify: `apps/customer/src/routes/_authenticated/checkout/$checkoutId/pay.tsx:107`
- Modify: `apps/customer/src/features/profile/profile-identity.tsx:12-24`
- Test: `apps/customer/src/features/products/format-characteristic.test.ts` (esiste; usa l'helper `c()` e `labels` già definiti in testa al file)

**Interfaces:**
- Consumes: `intlLocale()` da `@bibs/ui/lib/intl-locale` (Task 2).

- [ ] **Step 1: Test che fallisce sul numero delle caratteristiche**

In `format-characteristic.test.ts` aggiungi agli import `afterEach` (da `vitest`) e `import { setIntlLocaleResolver } from "@bibs/ui/lib/intl-locale";`, poi in fondo:

```ts
describe("formatCharacteristicValue in English", () => {
	afterEach(() => setIntlLocaleResolver(() => "it-IT"));

	it("uses the user's separators, and switches back", () => {
		const row = c({ dataType: "number", value: 12345.5, unit: "g" });
		setIntlLocaleResolver(() => "en-GB");
		expect(formatCharacteristicValue(row, labels)).toBe(`12,345.5${NBSP}g`);
		setIntlLocaleResolver(() => "it-IT");
		expect(formatCharacteristicValue(row, labels)).toBe(`12.345,5${NBSP}g`);
	});
});
```

Run: `bun run --filter @bibs/customer test -- src/features/products/format-characteristic`
Expected: FAIL sul caso `en-GB` (`1,5`).

- [ ] **Step 2: Sostituisci i `it-IT`**

`format-characteristic.ts`: elimina `const NUMBER = …` (riga 15) e a riga 38:

```ts
			const n = new Intl.NumberFormat(intlLocale(), {
				// Quattro decimali: la precisione di numeric(14,4) lato database.
				maximumFractionDigits: 4,
			}).format(value);
```

Negli altri cinque file sostituisci la stringa `"it-IT"` con `intlLocale()`:

```ts
const date = at.toLocaleString(intlLocale(), DATE_FMT);              // order-display.ts
{row.createdAt.toLocaleDateString(intlLocale(), DATE_FMT)}           // points.tsx
{new Date(o.createdAt).toLocaleDateString(intlLocale(), DATE_FMT)}   // orders/index.tsx
{new Date(order.createdAt).toLocaleString(intlLocale(), DATETIME_FMT)} // orders/$orderId.tsx
time: new Date(expiresAt).toLocaleTimeString(intlLocale(), TIME_FMT), // pay.tsx
```

con `import { intlLocale } from "@bibs/ui/lib/intl-locale";` in ognuno.

`profile-identity.tsx`: elimina `LOCALE_TAGS` e l'import di `getLocale`; in `formatMonthYear` usa `new Intl.DateTimeFormat(intlLocale(), { … })`.

- [ ] **Step 3: Nessun `it-IT` residuo nel customer**

Run: `grep -rn "it-IT" apps/customer/src | grep -v "src/paraglide/\|\.test\."`
Expected: nessun risultato.

- [ ] **Step 4: Test e commit**

Run: `bun run --filter @bibs/customer typecheck && bun run --filter @bibs/customer test`
Expected: PASS.

```bash
git add apps/customer/src
git commit -m "feat(customer): date e numeri nella lingua dell'utente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verifica completa, audit e smoke

**Files:**
- Modify: `docs/audit/2026-09-24-followup-gap-analysis.md` (P4 e «Chiusi»)
- Modify: `docs/superpowers/specs/2026-10-04-locale-en-cookie-design.md` (`Status: approved`, nota su `LocaleToggle` con nomi nativi)

- [ ] **Step 1: Suite completa e build**

Run: `bun run test` — Expected: exit 0, nessun fallimento in nessun workspace (leggi l'output per workspace).
Run: `for a in customer seller admin; do (cd apps/$a && bunx vite build) || echo "FAIL $a"; done` — Expected: nessun `FAIL`.
Run: `git status --short apps/*/src/routeTree.gen.ts` — Expected: vuoto (nessuna rotta nuova).

- [ ] **Step 2: Curl SSR** — ripeti lo Step 6 del Task 1 sui tre dev server, più sul customer:

```bash
curl -s -H 'Cookie: PARAGLIDE_LOCALE=en' localhost:3001/login | grep -o 'Show password\|Language' | sort -u
```

Expected: `Language` (footer) e, nel markup del campo password, `Show password`.

- [ ] **Step 3: Audit**

In `docs/audit/2026-09-24-followup-gap-analysis.md`:
- P4: elimina il punto «Locale `en` irraggiungibile»; riscrivi «i18n, residui» così:
  «**i18n, residui** (#219/#220, #<PR>): seller e admin da tradurre (~450 stringhe in ~75 file il seller, ~350 in ~45 l'admin; `it-IT` hardcoded, `Calendar` senza `locale`, `TableColumnsToggle`/`DataPagination`/`PageSizeSelector`/`CopyButton` di `packages/ui`): il selettore lì è solo in dev. Lingua solo nel cookie, per browser e per app: `user.locale` nel DB la farebbe seguire l'utente e permetterebbe email ed errori API nella sua lingua (oggi in italiano anche con UI inglese). Messaggi 422 di Elysia/TypeBox in inglese: PR a parte con traduzione centralizzata nell'error-handler per tipo di errore TypeBox.»
- «Chiusi»: nuova riga
  `| **P4 (locale en)** | Lingua nel cookie (strategia Paraglide `cookie` + `baseLocale`, niente prefisso URL: le tre app sono dietro login) e `paraglideMiddleware` in `src/server.ts`, quindi `<html lang>` e testi giusti in SSR. `LocaleToggle` condiviso (IT/EN, nomi nativi) nel menu utente e, nel customer, sulle pagine auth; in seller e admin solo in dev. Prezzi e date di `@bibs/ui` seguono la lingua tramite un resolver registrato da ogni app (`formatDateIt` → `formatDate`). Customer interamente in inglese: ultime stringhe, `ThemeToggle`/`PasswordInput` con `labels`, `it-IT` → `intlLocale()` | #<PR> |`

Il numero di PR si mette dopo `gh pr create`, con un commit di follow-up.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(audit): locale en chiusa, residui i18n aggiornati

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Smoke guidato con Marco** (gate prima della PR)

Customer :3001, da utente sloggato e poi loggato (customer1):
1. `/login`: footer IT/EN; EN → ricarica, tutto in inglese, `lang="en"`; tastiera: Tab fino al vassoio, frecce, Invio.
2. Login, home, `/stores`, scheda negozio (stato aperto/chiuso), prodotto, carrello, checkout fino al riepilogo: prezzi `€12.50`, date `04/10/2026`, nessuna stringa italiana.
3. Menu utente: tema e lingua tradotti; torna a IT → tutto italiano, prezzi `12,50 €`.
4. Console: nessun warning di hydration dopo i cambi lingua.

Seller :3002 e admin :3003 (dev): selettore nel menu utente, EN cambia `lang` e le poche stringhe tradotte, IT torna indietro.

Solo dopo l'ok: `superpowers:finishing-a-development-branch`.
