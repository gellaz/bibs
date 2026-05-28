# Municipality Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire i campi testuali `city`/`province` con FK `municipalityId` su 4 tabelle, esporre un endpoint che pre-carica tutti i comuni italiani, e introdurre un `MunicipalityCombobox` riusabile nei 3 form seller (onboarding, store, profile).

**Architecture:** Backend Drizzle/Elysia che (a) aggiunge `GET /locations/municipalities/all` con payload compatto cacheable, (b) muta 4 tabelle (`organization`, `store`, `customerAddress`, `sellerProfile`) sostituendo `city`/`province` testuali con FK `text → municipality(id)`. Frontend con un componente pure-UI in `@bibs/ui` sopra il `Combobox` di `@base-ui/react`, alimentato in ogni app da un hook TanStack Query con `staleTime: Infinity` e prefetchato nei loader TanStack Router.

**Tech Stack:** Elysia + Drizzle + bun:test, TanStack Start/Router/Query, react-hook-form + typeboxResolver, `@bibs/ui` con `@base-ui/react` Combobox, Paraglide (label hardcoded italiane nei form, coerente col resto del codebase).

**Spec source:** `docs/superpowers/specs/2026-05-28-municipality-combobox-design.md`

**Branch:** `feat/municipality-combobox` (già creato).

---

## File Structure

### Backend (apps/api)

**Create:**
- `apps/api/tests/modules/locations.test.ts` — test unit per `listAllMunicipalities` (count, ordering, shape).
- `apps/api/src/db/migrations/XXXX_municipality_fk.sql` — generato da `bun run db:generate` dopo aver modificato gli schemi TS.

**Modify:**
- `apps/api/src/db/schemas/organization.ts` — drop `city`, `province`; add `municipalityId text NOT NULL FK`.
- `apps/api/src/db/schemas/store.ts` — drop `city`, `province`; add `municipalityId text NOT NULL FK`.
- `apps/api/src/db/schemas/address.ts` (`customerAddress`) — drop `city`, `province`; add `municipalityId text NOT NULL FK`.
- `apps/api/src/db/schemas/seller.ts` — drop `residenceCity`, `documentIssuedMunicipality`; add `residenceMunicipalityId text NULL FK`, `documentIssuedMunicipalityId text NULL FK`.
- `apps/api/src/lib/schemas/locations.ts` (o file equivalente che esporta `MunicipalitySchema`) — aggiungere `MunicipalityCompactSchema` `{ id, name, provinciaAcronym }`.
- `apps/api/src/modules/locations/services/locations.ts` — aggiungere `listAllMunicipalities()`.
- `apps/api/src/modules/locations/routes/locations.ts` — aggiungere route `GET /municipalities/all`.
- `apps/api/src/modules/sellers/services/onboarding.ts` (e/o services correlati) — scrivere `municipalityId` invece di `city`/`province`; reads con JOIN su `municipality`+`province`.
- `apps/api/src/modules/sellers/services/profile.ts` — idem per `residenceMunicipalityId` e `documentIssuedMunicipalityId`.
- `apps/api/src/modules/stores/services/*.ts` — scrivere/leggere `municipalityId`.
- `apps/api/src/lib/schemas/forms/onboarding.ts` — `CompanyBody` e `DocumentBody`: drop testi, add UUID id.
- `apps/api/src/lib/schemas/forms/settings.ts` — `CompanySettingsBody`, `DocumentChangeBody`: idem.
- `apps/api/src/lib/schemas/forms/stores.ts` — `CreateStoreBody`: idem.
- `apps/api/src/db/seed/fixtures/utils.ts` — rimuovere array `cities`, esporre helper `pickMunicipalityIdByIstat(code)`.
- `apps/api/src/db/seed/fixtures/sellers.ts` — popolare `municipalityId` via helper.
- `apps/api/src/db/seed/fixtures/dev-seller.ts` — popolare `municipalityId` via ISTAT code di Milano.

### Frontend (packages/ui)

**Create:**
- `packages/ui/src/components/municipality-combobox.tsx` — componente pure-UI.

### Frontend (apps/seller)

**Create:**
- `apps/seller/src/lib/hooks/use-municipalities.ts` — hook TanStack Query + `municipalitiesQueryOptions()`.

**Modify:**
- `apps/seller/src/routes/_authenticated/onboarding/company.tsx` — drop city/province, add `<MunicipalityCombobox>` via `<Controller>`; loader prefetch.
- `apps/seller/src/features/stores/components/store-form.tsx` — idem.
- `apps/seller/src/features/profile/components/business-info-card.tsx` — idem.

---

## Tasks

### Task 1: Schema TypeBox compatto per MunicipalityCompact

**Files:**
- Modify: `apps/api/src/lib/schemas/locations.ts`

Verifica la posizione esatta dello schema `MunicipalitySchema` esistente prima di scrivere — potrebbe essere in `apps/api/src/lib/schemas/locations.ts` o in `apps/api/src/lib/schemas/index.ts`. Cerca con `grep -r "export const MunicipalitySchema" apps/api/src/lib/schemas`.

- [ ] **Step 1: Trova il file dello schema esistente**

```bash
grep -rn "export const MunicipalitySchema" apps/api/src/lib/schemas
```

Expected: stampa il path del file (es. `apps/api/src/lib/schemas/locations.ts:12`).

- [ ] **Step 2: Aggiungi `MunicipalityCompactSchema` nello stesso file**

Inserisci subito dopo `MunicipalitySchema`:

```ts
export const MunicipalityCompactSchema = t.Object(
	{
		id: t.String({ description: "ID del comune (UUID)" }),
		name: t.String({ description: "Nome del comune" }),
		provinciaAcronym: t.String({
			minLength: 2,
			maxLength: 2,
			description: "Sigla provincia (2 lettere)",
		}),
	},
	{ description: "Comune in formato compatto per liste precaricate" },
);
```

Assicurati che `t` sia già importato da `elysia` in cima al file (è quasi sicuro: gli altri schemi lo usano).

- [ ] **Step 3: Re-export se index.ts ha un barrel**

```bash
grep -n "MunicipalitySchema" apps/api/src/lib/schemas/index.ts
```

Se trovi un re-export `export { MunicipalitySchema } from "./locations"`, aggiungi `MunicipalityCompactSchema` allo stesso elenco.

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: PASS (nessun import lo usa ancora).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/schemas/
git commit -m "feat(api): add MunicipalityCompactSchema TypeBox"
```

---

### Task 2: Service `listAllMunicipalities` + test

**Files:**
- Modify: `apps/api/src/modules/locations/services/locations.ts`
- Create: `apps/api/tests/modules/locations.test.ts`

- [ ] **Step 1: Scrivi il test failing**

Crea `apps/api/tests/modules/locations.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { listAllMunicipalities } from "@/modules/locations/services/locations";

describe("listAllMunicipalities", () => {
	it("returns the full list of municipalities", async () => {
		const data = await listAllMunicipalities();
		expect(data.length).toBeGreaterThan(7000);
		expect(data.length).toBeLessThan(8500);
	});

	it("returns the compact shape { id, name, provinciaAcronym }", async () => {
		const data = await listAllMunicipalities();
		const first = data[0];
		expect(first).toBeDefined();
		expect(Object.keys(first!).sort()).toEqual([
			"id",
			"name",
			"provinciaAcronym",
		]);
		expect(first!.provinciaAcronym).toHaveLength(2);
	});

	it("returns items sorted by name ASC", async () => {
		const data = await listAllMunicipalities();
		for (let i = 1; i < Math.min(data.length, 50); i++) {
			const prev = data[i - 1]!.name.localeCompare(data[i]!.name, "it");
			expect(prev).toBeLessThanOrEqual(0);
		}
	});

	it("provinciaAcronym is uppercase", async () => {
		const data = await listAllMunicipalities();
		const sample = data.slice(0, 20);
		for (const m of sample) {
			expect(m.provinciaAcronym).toBe(m.provinciaAcronym.toUpperCase());
		}
	});
});
```

- [ ] **Step 2: Run test → FAIL**

```bash
cd apps/api && bun test tests/modules/locations.test.ts
```

Expected: FAIL with `listAllMunicipalities is not exported` o simile.

- [ ] **Step 3: Implementa il service**

Apri `apps/api/src/modules/locations/services/locations.ts`. In cima aggiorna gli import:

```ts
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { COUNTRIES } from "@/lib/countries";
import { parsePagination } from "@/lib/pagination";
```

In fondo al file aggiungi:

```ts
export async function listAllMunicipalities() {
	return db
		.select({
			id: municipality.id,
			name: municipality.name,
			provinciaAcronym: province.acronym,
		})
		.from(municipality)
		.innerJoin(province, eq(municipality.provinceId, province.id))
		.orderBy(asc(municipality.name));
}
```

- [ ] **Step 4: Run test → PASS**

```bash
cd apps/api && bun test tests/modules/locations.test.ts
```

Expected: 4 PASS. Se fallisce per `province.acronym` ordering vs `it.localeCompare`, controlla che il seed sia stato eseguito (`bun run infra:reset && bun run db:migrate && bun run db:seed` da root).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/locations/services/locations.ts apps/api/tests/modules/locations.test.ts
git commit -m "feat(api): listAllMunicipalities service + test"
```

---

### Task 3: Endpoint `GET /locations/municipalities/all`

**Files:**
- Modify: `apps/api/src/modules/locations/routes/locations.ts`

- [ ] **Step 1: Aggiorna gli import**

In cima a `apps/api/src/modules/locations/routes/locations.ts`, aggiungi `listAllMunicipalities` e `MunicipalityCompactSchema`:

```ts
import { Elysia, t } from "elysia";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okPage } from "@/lib/responses";
import {
	CountrySchema,
	MunicipalityCompactSchema,
	MunicipalitySchema,
	okPageRes,
	okRes,
	ProvinceSchema,
	RegionSchema,
	withErrors,
} from "@/lib/schemas";
import {
	listAllMunicipalities,
	listCountries,
	listMunicipalities,
	listProvinces,
	listRegions,
} from "../services/locations";
```

- [ ] **Step 2: Aggiungi la route dopo `/municipalities`**

Subito dopo la chain `.get("/municipalities", …)`, prima del punto e virgola finale:

```ts
		.get(
			"/municipalities/all",
			async ({ set }) => {
				const data = await listAllMunicipalities();
				set.headers["cache-control"] =
					"public, max-age=86400, stale-while-revalidate=604800";
				return ok(data);
			},
			{
				response: withErrors({ 200: okRes(t.Array(MunicipalityCompactSchema)) }),
				detail: {
					summary: "Lista completa comuni (formato compatto)",
					description:
						"Restituisce l'elenco di TUTTI i comuni italiani con sigla provincia, in formato compatto e ordinati per nome. Endpoint pensato per precaricamento client-side; risposta cacheable 24h.",
					tags: ["Locations"],
				},
			},
		);
```

- [ ] **Step 3: Avvia il server e verifica risposta**

In un terminale:

```bash
bun run dev:api
```

In un altro:

```bash
curl -i http://localhost:3000/locations/municipalities/all | head -20
```

Expected: header `cache-control: public, max-age=86400, stale-while-revalidate=604800` + body JSON che inizia con `{"data":[{"id":"…","name":"Abano Terme","provinciaAcronym":"PD"},…`.

Chiudi il server con Ctrl+C.

- [ ] **Step 4: Verifica OpenAPI**

```bash
bun run dev:api
```

Apri http://localhost:3000/openapi nel browser. Verifica che esista la entry `GET /locations/municipalities/all` con `summary` "Lista completa comuni (formato compatto)" sotto il tag `Locations`. Chiudi il server.

- [ ] **Step 5: Typecheck e commit**

```bash
bun run typecheck
git add apps/api/src/modules/locations/routes/locations.ts
git commit -m "feat(api): expose GET /locations/municipalities/all"
```

---

### Task 4: Componente `MunicipalityCombobox` in `@bibs/ui`

**Files:**
- Create: `packages/ui/src/components/municipality-combobox.tsx`

Il componente è pure-UI: riceve i dati e l'handler come prop, non importa Eden.

- [ ] **Step 1: Crea il file**

Crea `packages/ui/src/components/municipality-combobox.tsx`:

```tsx
"use client";

import * as React from "react";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "~/components/combobox";

export type MunicipalityOption = {
	id: string;
	name: string;
	provinciaAcronym: string;
};

export type MunicipalityComboboxProps = {
	value: string | null;
	onChange: (id: string | null) => void;
	municipalities: MunicipalityOption[] | undefined;
	loading?: boolean;
	error?: boolean;
	placeholder?: string;
	disabled?: boolean;
	id?: string;
	"aria-invalid"?: boolean;
	"aria-describedby"?: string;
};

const VISIBLE_CAP = 50;

function normalize(value: string) {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

type Indexed = MunicipalityOption & { searchKey: string };

function indexMunicipalities(list: MunicipalityOption[]): Indexed[] {
	return list.map((m) => ({
		...m,
		searchKey: `${normalize(m.name)} (${m.provinciaAcronym.toLowerCase()})`,
	}));
}

function filterMunicipalities(
	indexed: Indexed[],
	query: string,
): { items: MunicipalityOption[]; total: number } {
	if (!query.trim()) {
		return { items: indexed.slice(0, VISIBLE_CAP), total: indexed.length };
	}
	const q = normalize(query);
	const starts: Indexed[] = [];
	const includes: Indexed[] = [];
	for (const item of indexed) {
		if (item.searchKey.startsWith(q)) starts.push(item);
		else if (item.searchKey.includes(q)) includes.push(item);
	}
	const total = starts.length + includes.length;
	const merged = [...starts, ...includes].slice(0, VISIBLE_CAP);
	return { items: merged, total };
}

function MunicipalityCombobox({
	value,
	onChange,
	municipalities,
	loading = false,
	error = false,
	placeholder = "Cerca comune…",
	disabled,
	id,
	...ariaProps
}: MunicipalityComboboxProps) {
	const [query, setQuery] = React.useState("");

	const indexed = React.useMemo(
		() => (municipalities ? indexMunicipalities(municipalities) : []),
		[municipalities],
	);

	const { items, total } = React.useMemo(
		() => filterMunicipalities(indexed, query),
		[indexed, query],
	);

	const isLoading = loading || municipalities === undefined;
	const triggerDisabled = disabled || isLoading || error;

	const selected =
		value && municipalities
			? municipalities.find((m) => m.id === value) ?? null
			: null;

	const computedPlaceholder = error
		? "Impossibile caricare i comuni"
		: isLoading
			? "Caricamento comuni…"
			: placeholder;

	return (
		<Combobox
			items={items}
			itemToStringLabel={(item: MunicipalityOption) =>
				`${item.name} (${item.provinciaAcronym})`
			}
			itemToStringValue={(item: MunicipalityOption) => item.id}
			value={selected}
			onValueChange={(item: MunicipalityOption | null) =>
				onChange(item?.id ?? null)
			}
			onInputValueChange={(next: string) => setQuery(next)}
		>
			<ComboboxInput
				id={id}
				placeholder={computedPlaceholder}
				disabled={triggerDisabled}
				aria-invalid={ariaProps["aria-invalid"]}
				aria-describedby={ariaProps["aria-describedby"]}
				showClear={!!selected}
			/>
			<ComboboxContent>
				<ComboboxList>
					{items.map((item) => (
						<ComboboxItem key={item.id} value={item}>
							{item.name} ({item.provinciaAcronym})
						</ComboboxItem>
					))}
				</ComboboxList>
				<ComboboxEmpty>Nessun comune trovato</ComboboxEmpty>
				{total > VISIBLE_CAP && (
					<div className="text-muted-foreground border-t px-3 py-2 text-center text-xs">
						… altri {total - VISIBLE_CAP} risultati, raffina la ricerca
					</div>
				)}
			</ComboboxContent>
		</Combobox>
	);
}

export { MunicipalityCombobox };
```

> **Nota**: le props esatte `itemToStringLabel`/`itemToStringValue`/`value`/`onValueChange`/`onInputValueChange` di `@base-ui/react` Combobox vanno verificate. Apri `packages/ui/src/components/combobox.tsx` e l'API ufficiale `@base-ui/react` Combobox via `bunx --bun context7 …` o leggi `node_modules/@base-ui/react/dist/combobox.d.ts`. Se le prop hanno nomi diversi (es. `onValueChange` → `onItemSelect`, ecc.), adatta. Il fallback semantico è: input controlled per la query, list filtrata, selezione emette l'oggetto item, riceviamo `{ id }` e propaghiamo `onChange`.

- [ ] **Step 2: Verifica API Base UI Combobox**

```bash
cat node_modules/@base-ui/react/dist/combobox.d.ts 2>/dev/null | head -150
```

Se non esiste, prova:

```bash
find node_modules/@base-ui -name "*.d.ts" -path "*combobox*" | head -5
```

Aggiorna i nomi delle prop nel file appena creato per allinearle alle definizioni reali.

- [ ] **Step 3: Typecheck del package UI**

```bash
bun run --filter @bibs/ui typecheck
```

Expected: PASS. Se fallisce su prop name del Combobox, correggi e riprova.

- [ ] **Step 4: Verifica che il barrel `@bibs/ui/components/municipality-combobox` sia importabile**

`packages/ui` espone i componenti via `package.json` `exports`. Verifica:

```bash
cat packages/ui/package.json | grep -A 30 '"exports"'
```

Se il pattern è `"./components/*": "./src/components/*.tsx"` (subpath wildcard), nessuna modifica serve. Se ogni componente è elencato individualmente, aggiungi la entry `"./components/municipality-combobox"`.

- [ ] **Step 5: Lint**

```bash
bun run lint
```

Expected: PASS o solo warning.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/municipality-combobox.tsx packages/ui/package.json
git commit -m "feat(ui): MunicipalityCombobox component"
```

---

### Task 5: Migrazione schema TS Drizzle (4 tabelle)

**Files:**
- Modify: `apps/api/src/db/schemas/organization.ts`
- Modify: `apps/api/src/db/schemas/store.ts`
- Modify: `apps/api/src/db/schemas/address.ts`
- Modify: `apps/api/src/db/schemas/seller.ts`

- [ ] **Step 1: `organization.ts`**

Sostituisci la definizione corrente delle colonne `province` e `city` con `municipalityId`. In cima al file aggiungi:

```ts
import { municipality } from "./location";
```

E `index` agli import drizzle se non presente:

```ts
import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
```

Sostituisci il blocco colonne (riga 18-23 originali):

```ts
	businessName: text("business_name").notNull(),
	vatNumber: text("vat_number").notNull().unique(),
	legalForm: text("legal_form").notNull(),
	addressLine1: text("address_line1").notNull(),
	country: varchar("country", { length: 2 }).notNull().default("IT"),
	municipalityId: text("municipality_id")
		.notNull()
		.references(() => municipality.id, { onDelete: "restrict" }),
	zipCode: text("zip_code").notNull(),
```

Le righe `province: text("province")` e `city: text("city").notNull()` vanno **rimosse**.

`pgTable` non aveva un secondo argomento (config indici): aggiungilo per indicizzare la FK:

```ts
export const organization = pgTable(
	"organizations",
	{
		// … colonne come sopra
	},
	(t) => [index("organization_municipality_id_idx").on(t.municipalityId)],
);
```

Aggiungi la relation:

```ts
export const organizationRelations = relations(organization, ({ one }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [organization.sellerProfileId],
		references: [sellerProfile.id],
	}),
	municipality: one(municipality, {
		fields: [organization.municipalityId],
		references: [municipality.id],
	}),
}));
```

- [ ] **Step 2: `store.ts`**

Aggiungi import `municipality`:

```ts
import { municipality } from "./location";
```

Sostituisci nel blocco colonne (righe 31-33 originali):

```ts
	addressLine1: text("address_line1").notNull(),
	addressLine2: text("address_line2"),
	municipalityId: text("municipality_id")
		.notNull()
		.references(() => municipality.id, { onDelete: "restrict" }),
	zipCode: text("zip_code").notNull(),
	country: varchar("country", { length: 2 }).notNull().default("IT"),
```

Rimuovi `city`, `province`.

Aggiungi un indice nel `(t) => [...]`:

```ts
	(t) => [
		index("store_location_idx").using("gist", t.location),
		index("store_seller_profile_id_idx").on(t.sellerProfileId),
		index("store_municipality_id_idx").on(t.municipalityId),
		index("store_active_idx")
			.on(t.sellerProfileId)
			.where(sql`${t.deletedAt} IS NULL`),
	],
```

Aggiungi la relation `municipality` allo `storeRelations`:

```ts
export const storeRelations = relations(store, ({ one, many }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [store.sellerProfileId],
		references: [sellerProfile.id],
	}),
	category: one(storeCategory, {
		fields: [store.categoryId],
		references: [storeCategory.id],
	}),
	municipality: one(municipality, {
		fields: [store.municipalityId],
		references: [municipality.id],
	}),
	subscription: one(storeSubscription, {
		fields: [store.id],
		references: [storeSubscription.storeId],
	}),
	storeProducts: many(storeProduct),
	phoneNumbers: many(storePhoneNumber),
	images: many(storeImage),
}));
```

- [ ] **Step 3: `address.ts` (`customerAddress`)**

Aggiungi import `municipality`:

```ts
import { municipality } from "./location";
```

Sostituisci colonne (righe 23-28 originali):

```ts
	addressLine1: text("address_line1").notNull(),
	addressLine2: text("address_line2"),
	municipalityId: text("municipality_id")
		.notNull()
		.references(() => municipality.id, { onDelete: "restrict" }),
	zipCode: text("zip_code").notNull(),
	country: varchar("country", { length: 2 }).notNull().default("IT"),
```

Rimuovi `city`, `province`.

Aggiungi indice:

```ts
	(t) => [
		index("customer_address_location_idx").using("gist", t.location),
		index("customer_address_profile_id_idx").on(t.customerProfileId),
		index("customer_address_municipality_id_idx").on(t.municipalityId),
		uniqueIndex("customer_address_single_default_idx")
			.on(t.customerProfileId)
			.where(sql`${t.isDefault} = true`),
	],
```

Aggiungi relation:

```ts
export const customerAddressRelations = relations(
	customerAddress,
	({ one }) => ({
		customerProfile: one(customerProfile, {
			fields: [customerAddress.customerProfileId],
			references: [customerProfile.id],
		}),
		municipality: one(municipality, {
			fields: [customerAddress.municipalityId],
			references: [municipality.id],
		}),
	}),
);
```

- [ ] **Step 4: `seller.ts`**

Aggiungi import `municipality`:

```ts
import { municipality } from "./location";
```

Sostituisci nel blocco anagrafica/documento (righe 51 e 58 originali):

```ts
		// ── Anagrafica ────────────────────────────
		firstName: text("first_name"),
		lastName: text("last_name"),
		citizenship: text("citizenship"),
		birthCountry: text("birth_country"),
		birthDate: date("birth_date", { mode: "string" }),
		residenceCountry: text("residence_country"),
		residenceMunicipalityId: text("residence_municipality_id").references(
			() => municipality.id,
			{ onDelete: "restrict" },
		),
		residenceAddress: text("residence_address"),
		residenceZipCode: text("residence_zip_code"),

		// ── Documento identità ────────────────────
		documentNumber: text("document_number"),
		documentExpiry: date("document_expiry", { mode: "string" }),
		documentIssuedMunicipalityId: text(
			"document_issued_municipality_id",
		).references(() => municipality.id, { onDelete: "restrict" }),
		documentImageKey: text("document_image_key"),
		documentImageUrl: text("document_image_url"),
```

Rimuovi `residenceCity` e `documentIssuedMunicipality` (le righe testuali).

Aggiungi 2 indici nel `(table) => [...]`:

```ts
	(table) => [
		index("seller_profile_onboarding_status_idx").on(table.onboardingStatus),
		index("seller_profile_residence_municipality_idx").on(
			table.residenceMunicipalityId,
		),
		index("seller_profile_document_municipality_idx").on(
			table.documentIssuedMunicipalityId,
		),
	],
```

Estendi `sellerProfileRelations` (opzionale ma utile per JOIN nei service):

```ts
export const sellerProfileRelations = relations(
	sellerProfile,
	({ one, many }) => ({
		user: one(user, {
			fields: [sellerProfile.userId],
			references: [user.id],
		}),
		organization: one(organization),
		employees: many(storeEmployee),
		invitations: many(employeeInvitation),
		changes: many(sellerProfileChange),
		residenceMunicipality: one(municipality, {
			fields: [sellerProfile.residenceMunicipalityId],
			references: [municipality.id],
			relationName: "residenceMunicipality",
		}),
		documentIssuedMunicipality: one(municipality, {
			fields: [sellerProfile.documentIssuedMunicipalityId],
			references: [municipality.id],
			relationName: "documentIssuedMunicipality",
		}),
	}),
);
```

> `relationName` distingue le due relazioni 1:1 verso la stessa tabella `municipality`. Senza sarebbe ambiguo per Drizzle.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: FAIL su molti file `apps/api/src/modules/**` e `apps/seller/src/**` perché i service e i form referenziano ancora `city`/`province`. **Questo è atteso** — i prossimi task li sistemano. Verifica che gli errori siano del tipo `Property 'city' does not exist on type` e simili, non errori di Drizzle internamente coerente.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schemas/
git commit -m "feat(api): switch organization/store/customerAddress/sellerProfile to municipalityId FK"
```

---

### Task 6: Generare e applicare la migration SQL

**Files:**
- Create: `apps/api/src/db/migrations/XXXX_<auto-name>.sql`

- [ ] **Step 1: Pulizia volumi locali**

> **ATTENZIONE: comando distruttivo del DB locale**. Bibs è in dev e lo spec prevede questo (`infra:reset` + `db:migrate` + `db:seed`). Conferma prima di eseguire se hai dati locali che vuoi tenere.

```bash
bun run infra:reset
```

Expected: container Postgres riavviato pulito.

- [ ] **Step 2: Genera la migration**

```bash
bun run db:generate
```

Expected: crea un nuovo file in `apps/api/src/db/migrations/XXXX_<auto-name>.sql`. Output del comando include il path esatto.

- [ ] **Step 3: Leggi la SQL generata**

Apri il file generato in editor o:

```bash
ls -1t apps/api/src/db/migrations/*.sql | head -1 | xargs cat
```

Verifica che contenga (per ognuna delle 4 tabelle):
- `ALTER TABLE "<nome>" DROP COLUMN "city";` (dove applicabile)
- `ALTER TABLE "<nome>" DROP COLUMN "province";` (dove applicabile)
- `ALTER TABLE "seller_profiles" DROP COLUMN "residence_city";`
- `ALTER TABLE "seller_profiles" DROP COLUMN "document_issued_municipality";`
- `ALTER TABLE "<nome>" ADD COLUMN "municipality_id" text NOT NULL;` (per organization/store/customer_addresses)
- `ALTER TABLE "seller_profiles" ADD COLUMN "residence_municipality_id" text;` (nullable)
- `ALTER TABLE "seller_profiles" ADD COLUMN "document_issued_municipality_id" text;` (nullable)
- I `CREATE INDEX` per i 4 idx aggiunti.
- I `FOREIGN KEY` references a `municipalities(id) ON DELETE RESTRICT`.

Se manca uno qualsiasi di questi, **non** procedere: torna a Task 5 e fixa lo schema TS.

- [ ] **Step 4: Applica la migration**

```bash
bun run db:migrate
```

Expected: stampa il nome del file migration e "applied".

- [ ] **Step 5: Verifica struttura DB**

```bash
docker exec -i $(docker ps -q --filter "name=postgres") psql -U postgres -d bibs -c "\d organizations" | grep -E "city|province|municipality_id"
```

Expected: 1 sola riga `municipality_id`. Niente `city`/`province`.

Ripeti per `stores`, `customer_addresses`, `seller_profiles`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/
git commit -m "feat(api): migration — drop city/province, add municipality_id FK"
```

---

### Task 7: Service layer — `organization` (onboarding company + settings)

**Files:**
- Modify: `apps/api/src/modules/sellers/services/onboarding.ts` (o file equivalente che gestisce `updateCompany`)
- Modify: `apps/api/src/modules/sellers/services/settings.ts` (o equivalente)

Verifica i file esatti con:

```bash
grep -rln "organization\." apps/api/src/modules/sellers/services
grep -rln "city" apps/api/src/modules/sellers/services
```

- [ ] **Step 1: Identifica i punti di scrittura `organization`**

Cerca ogni `insert`/`update` su `organization` che ancora settava `city`/`province`. Per ognuno:

```ts
// Prima:
await db.insert(organization).values({
	// …,
	city: input.city,
	province: input.province,
	zipCode: input.zipCode,
});

// Dopo:
await db.insert(organization).values({
	// …,
	municipalityId: input.municipalityId,
	zipCode: input.zipCode,
});
```

Stesso pattern per `db.update(organization).set({...})`.

- [ ] **Step 2: Identifica i punti di lettura `organization`**

Per ogni service che restituisce `organization` a una route (es. `getOnboardingState`, `getCompanySettings`):

```ts
// Prima:
const org = await db.query.organization.findFirst({
	where: eq(organization.sellerProfileId, sellerProfileId),
});
return org;

// Dopo:
const org = await db.query.organization.findFirst({
	where: eq(organization.sellerProfileId, sellerProfileId),
	with: {
		municipality: {
			columns: { id: true, name: true },
			with: { province: { columns: { acronym: true } } },
		},
	},
});
if (!org) return null;
return {
	...org,
	municipality: {
		id: org.municipality.id,
		name: org.municipality.name,
		provinciaAcronym: org.municipality.province.acronym,
	},
};
```

Riadatta la response schema della route corrispondente per esporre `municipality: { id, name, provinciaAcronym }` invece di `city`/`province`. Verifica il file route:

```bash
grep -rln "organization" apps/api/src/modules/sellers/routes
```

Aggiorna gli schemi response usando `MunicipalityCompactSchema` dove ora c'era `city: t.String()`/`province: t.Optional(...)`.

- [ ] **Step 3: Typecheck del modulo**

```bash
cd apps/api && bun run typecheck 2>&1 | grep -E "modules/sellers" | head -20
```

Risolvi gli errori uno alla volta. Lascia per ora gli errori in `apps/seller` (verranno fixati nei task frontend).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/sellers/
git commit -m "feat(api): organization service writes/reads via municipalityId"
```

---

### Task 8: Service layer — `store`

**Files:**
- Modify: `apps/api/src/modules/stores/services/*.ts`
- Modify: `apps/api/src/modules/stores/routes/*.ts` (response schemas)

- [ ] **Step 1: Identifica i punti**

```bash
grep -rln "store\." apps/api/src/modules/stores/services
grep -rln "city\|province" apps/api/src/modules/stores
```

- [ ] **Step 2: Update writes**

Per ogni `insert`/`update` su `store`:

```ts
// Prima:
await db.insert(store).values({
	// …,
	city: input.city,
	province: input.province,
	zipCode: input.zipCode,
});

// Dopo:
await db.insert(store).values({
	// …,
	municipalityId: input.municipalityId,
	zipCode: input.zipCode,
});
```

- [ ] **Step 3: Update reads con JOIN**

Per ogni read che ritorna `store` a una route:

```ts
const result = await db.query.store.findFirst({
	where: eq(store.id, storeId),
	with: {
		municipality: {
			columns: { id: true, name: true },
			with: { province: { columns: { acronym: true } } },
		},
	},
});
```

Se la query mappa già `result.city` → `data.city`, sostituisci con il flatten `municipality: { id, name, provinciaAcronym }`.

- [ ] **Step 4: Aggiorna response schemas route stores**

Apri ogni file in `apps/api/src/modules/stores/routes/`. Cerca `t.Object({...})` con `city`/`province` e sostituisci con `municipality: MunicipalityCompactSchema`.

Import in cima:

```ts
import { MunicipalityCompactSchema } from "@/lib/schemas";
```

- [ ] **Step 5: Typecheck modulo**

```bash
cd apps/api && bun run typecheck 2>&1 | grep -E "modules/stores" | head -20
```

Risolvi.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/stores/
git commit -m "feat(api): store service writes/reads via municipalityId"
```

---

### Task 9: Service layer — `sellerProfile` (residence + document)

**Files:**
- Modify: `apps/api/src/modules/sellers/services/*.ts` (file che gestiscono `updatePersonalInfo`, `updateDocument`, `getProfile`)
- Modify: `apps/api/src/modules/sellers/routes/*.ts` (response schemas)

- [ ] **Step 1: Identifica i punti**

```bash
grep -rln "residenceCity\|documentIssuedMunicipality" apps/api/src/modules
```

- [ ] **Step 2: Update writes**

Sostituisci ogni:

```ts
// Prima:
.set({ residenceCity: input.residenceCity, ... })

// Dopo:
.set({ residenceMunicipalityId: input.residenceMunicipalityId, ... })
```

Stesso pattern per `documentIssuedMunicipality` → `documentIssuedMunicipalityId`.

- [ ] **Step 3: Update reads con doppio JOIN**

Quando il service ritorna `sellerProfile`:

```ts
const profile = await db.query.sellerProfile.findFirst({
	where: eq(sellerProfile.userId, userId),
	with: {
		residenceMunicipality: {
			columns: { id: true, name: true },
			with: { province: { columns: { acronym: true } } },
		},
		documentIssuedMunicipality: {
			columns: { id: true, name: true },
			with: { province: { columns: { acronym: true } } },
		},
	},
});

if (!profile) return null;

return {
	...profile,
	residenceMunicipality: profile.residenceMunicipality
		? {
				id: profile.residenceMunicipality.id,
				name: profile.residenceMunicipality.name,
				provinciaAcronym: profile.residenceMunicipality.province.acronym,
			}
		: null,
	documentIssuedMunicipality: profile.documentIssuedMunicipality
		? {
				id: profile.documentIssuedMunicipality.id,
				name: profile.documentIssuedMunicipality.name,
				provinciaAcronym:
					profile.documentIssuedMunicipality.province.acronym,
			}
		: null,
};
```

- [ ] **Step 4: Update response schemas**

In ogni route che esponeva `residenceCity` o `documentIssuedMunicipality`, sostituisci:

```ts
// Prima:
residenceCity: t.Optional(t.String()),
documentIssuedMunicipality: t.Optional(t.String()),

// Dopo:
residenceMunicipality: t.Union([MunicipalityCompactSchema, t.Null()]),
documentIssuedMunicipality: t.Union([MunicipalityCompactSchema, t.Null()]),
```

- [ ] **Step 5: Typecheck modulo**

```bash
cd apps/api && bun run typecheck 2>&1 | grep -E "modules/sellers" | head -30
```

Risolvi.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sellers/
git commit -m "feat(api): sellerProfile residence + document via FK"
```

---

### Task 10: Schemi TypeBox forms

**Files:**
- Modify: `apps/api/src/lib/schemas/forms/onboarding.ts`
- Modify: `apps/api/src/lib/schemas/forms/settings.ts`
- Modify: `apps/api/src/lib/schemas/forms/stores.ts`

- [ ] **Step 1: `onboarding.ts` — `CompanyBody`**

Cerca il blocco con `city`, `province`, `zipCode` (linee ~117-134 per `CompanyBody`). Sostituisci:

```ts
// Prima:
	province: Type.Optional(
		Type.String({
			minLength: 2,
			maxLength: 5,
			errorMessage: "provincia non valida",
		}),
	),
	city: Type.String({
		minLength: 1,
		maxLength: 100,
		errorMessage: "città obbligatoria",
	}),
	zipCode: Type.String({
		pattern: "^\\d{5}$",
		errorMessage: "CAP non valido",
	}),

// Dopo:
	municipalityId: Type.String({
		minLength: 1,
		description: "ID del comune della sede legale",
		errorMessage: "comune obbligatorio",
	}),
	zipCode: Type.String({
		pattern: "^\\d{5}$",
		errorMessage: "CAP non valido",
	}),
```

- [ ] **Step 2: `onboarding.ts` — `DocumentBody`**

Cerca `documentIssuedMunicipality: Type.String(...)`:

```ts
// Prima:
	documentIssuedMunicipality: Type.String({
		minLength: 1,
		maxLength: 100,
		errorMessage: "comune di emissione obbligatorio",
	}),

// Dopo:
	documentIssuedMunicipalityId: Type.String({
		minLength: 1,
		description: "ID del comune di emissione del documento",
		errorMessage: "comune di emissione obbligatorio",
	}),
```

- [ ] **Step 3: `onboarding.ts` — `PersonalInfoBody`**

Cerca `residenceCity`. Sostituisci con `residenceMunicipalityId` (nota: deve mantenere lo stesso `Type.Optional` / required del campo originale; tipicamente è required in onboarding personal-info ma verifica):

```ts
// Prima:
	residenceCity: Type.String({
		minLength: 1,
		maxLength: 100,
		errorMessage: "città di residenza obbligatoria",
	}),

// Dopo:
	residenceMunicipalityId: Type.String({
		minLength: 1,
		description: "ID del comune di residenza",
		errorMessage: "comune di residenza obbligatorio",
	}),
```

- [ ] **Step 4: `settings.ts`**

Applica le stesse 3 sostituzioni su `CompanySettingsBody` (city/province → municipalityId), `DocumentChangeBody` (documentIssuedMunicipality → documentIssuedMunicipalityId) e `ProfileSettingsBody` o equivalente (residenceCity → residenceMunicipalityId).

- [ ] **Step 5: `stores.ts` — `CreateStoreBody`**

```ts
// Prima:
	city: Type.String({ minLength: 1, maxLength: 100, … }),
	zipCode: Type.String({ pattern: "^\\d{5}$" }),
	province: Type.Optional(Type.String({ minLength: 2, maxLength: 5, … })),

// Dopo:
	municipalityId: Type.String({
		minLength: 1,
		description: "ID del comune dello store",
		errorMessage: "comune obbligatorio",
	}),
	zipCode: Type.String({
		pattern: "^\\d{5}$",
		errorMessage: "CAP non valido",
	}),
```

Verifica anche `UpdateStoreBody` se esistente — applica le stesse sostituzioni.

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```

Expected: errori si concentrano ora su `apps/seller/**` (form). Le service `apps/api/**` devono compilare.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/schemas/forms/
git commit -m "feat(api): forms schemas use municipalityId"
```

---

### Task 11: Seed rewrite

**Files:**
- Modify: `apps/api/src/db/seed/fixtures/utils.ts`
- Modify: `apps/api/src/db/seed/fixtures/sellers.ts`
- Modify: `apps/api/src/db/seed/fixtures/dev-seller.ts`

- [ ] **Step 1: `utils.ts` — rimuovi array `cities`, aggiungi helper**

Apri `apps/api/src/db/seed/fixtures/utils.ts`. Rimuovi il blocco `export const cities: readonly CityData[] = [...]` (linee 118-429 circa) e l'interfaccia `CityData` (linea 110-116).

Aggiungi in fondo al file:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { municipality } from "@/db/schemas/location";

/**
 * Restituisce l'`id` del comune corrispondente a un codice ISTAT a 6 cifre.
 * Usato dal seed per creare riferimenti deterministici.
 */
export async function getMunicipalityIdByIstat(
	istatCode: string,
): Promise<string> {
	const row = await db.query.municipality.findFirst({
		where: eq(municipality.istatCode, istatCode),
		columns: { id: true },
	});
	if (!row) {
		throw new Error(
			`Seed: nessun comune con codice ISTAT ${istatCode}. Hai eseguito il seed base?`,
		);
	}
	return row.id;
}

/**
 * Set deterministico di comuni "vetrina" usati dai seed di sviluppo,
 * scelti per coprire diverse regioni. ISTAT code → handle mnemonic.
 */
export const SEED_MUNICIPALITIES = {
	milano: "015146",
	roma: "058091",
	torino: "001272",
	bologna: "037006",
	firenze: "048017",
	napoli: "063049",
	bari: "072006",
	palermo: "082053",
	genova: "010025",
	venezia: "027042",
} as const;

export type SeedMunicipalityHandle = keyof typeof SEED_MUNICIPALITIES;

export async function getSeedMunicipalityIds(): Promise<
	Record<SeedMunicipalityHandle, string>
> {
	const entries = await Promise.all(
		(Object.entries(SEED_MUNICIPALITIES) as Array<
			[SeedMunicipalityHandle, string]
		>).map(
			async ([key, istat]) =>
				[key, await getMunicipalityIdByIstat(istat)] as const,
		),
	);
	return Object.fromEntries(entries) as Record<SeedMunicipalityHandle, string>;
}
```

Verifica i codici ISTAT (gli 8 codici di esempio sopra sono i capoluoghi: Milano=015146, Roma=058091, ecc.; se uno fallisce, l'errore esplicito da `getMunicipalityIdByIstat` lo segnala).

- [ ] **Step 2: `sellers.ts` — aggiorna le fixture**

Cerca le occorrenze di `city`, `province` in `apps/api/src/db/seed/fixtures/sellers.ts`. La struttura tipica:

```ts
// Prima (linea ~103-141):
type SellerSeedData = {
	org: { /* …, city, province, zipCode */ };
	store: { /* …, city, province, zipCode */ };
	// …
};

// Dopo: rimuovi city/province, aggiungi municipalityHandle
type SellerSeedData = {
	org: { businessName: string; vatNumber: string; …; municipalityHandle: SeedMunicipalityHandle; zipCode: string; };
	store: { name: string; addressLine1: string; municipalityHandle: SeedMunicipalityHandle; zipCode: string; };
	// …
};
```

Aggiorna la generazione (linea ~328-346):

```ts
// Prima:
await db.insert(organization).values({
	// …
	city: seed.org.city,
	province: seed.org.province,
	zipCode: seed.org.zipCode,
});

// Dopo:
const municipalityIds = await getSeedMunicipalityIds();
// …
await db.insert(organization).values({
	// …
	municipalityId: municipalityIds[seed.org.municipalityHandle],
	zipCode: seed.org.zipCode,
});
```

Stessa cosa per `db.insert(store).values({...})`.

Per i mock-data esistenti che usavano `pickRandom(cities)`, sostituisci con un `pickRandom(Object.keys(SEED_MUNICIPALITIES))` che restituisce un handle.

- [ ] **Step 3: `dev-seller.ts`**

```ts
// Prima (linee 88-90, 103-105, 113-115):
{ city: "Milano", zipCode: "20121", province: "MI" }

// Dopo:
{ municipalityHandle: "milano", zipCode: "20121" }
```

Aggiorna gli inserts/updates corrispondenti per usare `municipalityIds.milano`.

- [ ] **Step 4: Run seed end-to-end**

```bash
bun run infra:reset && bun run db:migrate && bun run db:seed
```

Expected: chain verde, niente errori di FK o di colonne inesistenti.

- [ ] **Step 5: Spot check DB**

```bash
docker exec -i $(docker ps -q --filter "name=postgres") psql -U postgres -d bibs -c "SELECT o.id, o.municipality_id, m.name AS comune, p.acronym AS prov FROM organizations o JOIN municipalities m ON m.id = o.municipality_id JOIN provinces p ON p.id = m.province_id LIMIT 5;"
```

Expected: 5 righe con `comune` e `prov` valorizzati.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/seed/
git commit -m "feat(api): seed uses municipalityId via ISTAT handles"
```

---

### Task 12: Hook `useMunicipalities` in apps/seller

**Files:**
- Create: `apps/seller/src/lib/hooks/use-municipalities.ts`

- [ ] **Step 1: Crea il file**

```ts
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const municipalitiesQueryOptions = () =>
	queryOptions({
		queryKey: ["municipalities", "all"] as const,
		queryFn: async () => {
			const { data, error } = await api.locations.municipalities.all.get();
			if (error) throw error;
			return data.data;
		},
		staleTime: Infinity,
		gcTime: Infinity,
	});

export function useMunicipalities() {
	return useQuery(municipalitiesQueryOptions());
}
```

> **Nota**: il path Eden esatto dipende da come `api.locations` è strutturato in `apps/seller/src/lib/api.ts`. Se `api.locations.municipalities.all.get()` fallisce in typecheck, prova `api.locations["municipalities/all"].get()` o esamina la chain corretta con un autocomplete in IDE.

- [ ] **Step 2: Typecheck**

```bash
bun run --filter @bibs/seller typecheck 2>&1 | grep "use-municipalities" | head -5
```

Expected: nessun errore sul file appena creato.

- [ ] **Step 3: Commit**

```bash
git add apps/seller/src/lib/hooks/use-municipalities.ts
git commit -m "feat(seller): useMunicipalities hook with TanStack Query"
```

---

### Task 13: Refactor `onboarding/company.tsx`

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/onboarding/company.tsx`

- [ ] **Step 1: Aggiorna gli import in cima**

```tsx
import { CompanyBody } from "@bibs/api/schemas";
import { Button } from "@bibs/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { MunicipalityCombobox } from "@bibs/ui/components/municipality-combobox";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import { useGoBack, useUpdateCompany } from "@/hooks/use-onboarding";
import {
	municipalitiesQueryOptions,
	useMunicipalities,
} from "@/lib/hooks/use-municipalities";
```

- [ ] **Step 2: Aggiungi loader per prefetch**

Modifica la dichiarazione `createFileRoute`:

```tsx
export const Route = createFileRoute("/_authenticated/onboarding/company")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(municipalitiesQueryOptions()),
	component: CompanyPage,
});
```

> Se `context.queryClient` non esiste o il pattern del router è diverso (es. `beforeLoad`), verifica `apps/seller/src/routeTree.gen.ts` o un'altra route che già fa prefetch (cerca `ensureQueryData` con `grep -rn ensureQueryData apps/seller/src/routes | head -5`) e copia il pattern.

- [ ] **Step 3: Aggiungi `control` allo `useForm`**

```tsx
const {
	register,
	handleSubmit,
	control,
	formState: { errors, isSubmitting },
} = useForm<CompanyFormData>({
	resolver: typeboxResolver(compiledSchema),
	defaultValues: { country: "IT" },
});

const {
	data: municipalities,
	isLoading: municipalitiesLoading,
	isError: municipalitiesError,
} = useMunicipalities();
```

- [ ] **Step 4: Sostituisci il blocco city/province (linee 132-147)**

Rimuovi:

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
	<Field data-invalid={!!errors.city}>
		<FieldLabel htmlFor="city">Città</FieldLabel>
		<Input id="city" placeholder="Roma" {...register("city")} />
		<FieldError errors={[errors.city]} />
	</Field>
	<Field data-invalid={!!errors.province}>
		<FieldLabel htmlFor="province">Provincia</FieldLabel>
		<Input id="province" placeholder="RM" maxLength={2} {...register("province")} />
		<FieldError errors={[errors.province]} />
	</Field>
</div>
```

Sostituisci con:

```tsx
<Field data-invalid={!!errors.municipalityId}>
	<FieldLabel htmlFor="municipalityId">Comune</FieldLabel>
	<Controller
		control={control}
		name="municipalityId"
		render={({ field }) => (
			<MunicipalityCombobox
				id="municipalityId"
				value={field.value ?? null}
				onChange={field.onChange}
				municipalities={municipalities}
				loading={municipalitiesLoading}
				error={municipalitiesError}
				aria-invalid={!!errors.municipalityId}
			/>
		)}
	/>
	<FieldError errors={[errors.municipalityId]} />
</Field>
```

Lascia il blocco `zipCode` esistente subito sotto.

- [ ] **Step 5: Typecheck**

```bash
bun run --filter @bibs/seller typecheck 2>&1 | grep "company.tsx" | head -10
```

Expected: nessun errore su `company.tsx`. Errori restanti su altri form (verranno fixati nei task successivi).

- [ ] **Step 6: Smoke manuale**

```bash
bun run dev:seller
```

Apri http://localhost:3002, fai login con un seller in stato `pending_company` (vedi seed `dev-seller`), vai a `/onboarding/company`. Verifica:
- Il Combobox carica la lista (nessun flash visibile grazie al loader).
- Digita "milan" → vedi "Milano (MI)", "Milanello (CN)", "Milano Marittima" se esiste.
- Seleziona "Milano (MI)". Compila gli altri campi. Submit. Network panel mostra body con `municipalityId` UUID. Risposta 200.
- DB check: `SELECT municipality_id FROM organizations WHERE seller_profile_id = '…'` restituisce un UUID che matcha.

Chiudi il server.

- [ ] **Step 7: Commit**

```bash
git add apps/seller/src/routes/_authenticated/onboarding/company.tsx
git commit -m "feat(seller): onboarding company form uses MunicipalityCombobox"
```

---

### Task 14: Refactor `store-form.tsx`

**Files:**
- Modify: `apps/seller/src/features/stores/components/store-form.tsx`

- [ ] **Step 1: Aggiorna import**

Aggiungi:

```tsx
import { MunicipalityCombobox } from "@bibs/ui/components/municipality-combobox";
import { Controller } from "react-hook-form";
import { useMunicipalities } from "@/lib/hooks/use-municipalities";
```

- [ ] **Step 2: Hook nella component**

Subito sotto la dichiarazione `useForm`:

```tsx
const {
	data: municipalities,
	isLoading: municipalitiesLoading,
	isError: municipalitiesError,
} = useMunicipalities();
```

E assicurati di destrutturare `control` da `useForm`.

- [ ] **Step 3: Sostituisci il blocco city/province**

Cerca il blocco `<Field data-invalid={!!errors.city}>` … fino al chiusura `<Field>` per `province`. Sostituiscilo con un singolo blocco identico a quello del Task 13 step 4 (Field + Controller + MunicipalityCombobox).

Mantieni `zipCode` invariato.

- [ ] **Step 4: Loader prefetch**

Identifica la route che monta `<StoreForm>`. Cerca:

```bash
grep -rn "StoreForm\|store-form" apps/seller/src/routes | head -5
```

Nella route file, aggiungi al `loader` (o crealo se non esiste) il prefetch:

```tsx
loader: ({ context }) =>
	context.queryClient.ensureQueryData(municipalitiesQueryOptions()),
```

Import: `import { municipalitiesQueryOptions } from "@/lib/hooks/use-municipalities";`.

- [ ] **Step 5: Typecheck + smoke**

```bash
bun run --filter @bibs/seller typecheck
bun run dev:seller
```

Vai a `/stores/new` (o equivalente), verifica che il form funzioni. Submit, network panel mostra `municipalityId`. DB check `SELECT municipality_id FROM stores WHERE …`.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/features/stores/ apps/seller/src/routes/
git commit -m "feat(seller): store form uses MunicipalityCombobox"
```

---

### Task 15: Refactor `business-info-card.tsx`

**Files:**
- Modify: `apps/seller/src/features/profile/components/business-info-card.tsx`

- [ ] **Step 1: Stesso pattern dei task 13-14**

Aggiungi:
- Import `MunicipalityCombobox`, `Controller`, `useMunicipalities`.
- Hook `useMunicipalities()` nella component.
- Sostituisci il blocco city/province/zipCode con il pattern Field+Controller+MunicipalityCombobox.

- [ ] **Step 2: Loader prefetch sulla route che monta il card**

```bash
grep -rn "BusinessInfoCard\|business-info-card" apps/seller/src/routes | head -5
```

Aggiungi `municipalitiesQueryOptions()` al loader.

- [ ] **Step 3: Typecheck**

```bash
bun run --filter @bibs/seller typecheck
```

Expected: PASS.

- [ ] **Step 4: Smoke**

```bash
bun run dev:seller
```

Vai a `/settings/profile` (o equivalente). Modifica il comune. Submit. Verifica DB.

- [ ] **Step 5: Commit**

```bash
git add apps/seller/src/features/profile/ apps/seller/src/routes/
git commit -m "feat(seller): business info card uses MunicipalityCombobox"
```

---

### Task 16: Personal-info & document forms (residenceMunicipalityId, documentIssuedMunicipalityId)

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/onboarding/personal-info.tsx` (o file equivalente)
- Modify: `apps/seller/src/routes/_authenticated/onboarding/document.tsx`
- Modify: settings-equivalenti se esistono

- [ ] **Step 1: Identifica i file**

```bash
grep -rln "residenceCity\|documentIssuedMunicipality" apps/seller/src
```

- [ ] **Step 2: Per ogni file trovato, applica lo stesso pattern**

Sostituisci ogni `<Input {...register("residenceCity")} />` con un `MunicipalityCombobox` + `<Controller name="residenceMunicipalityId">`. Idem per `documentIssuedMunicipality` → `documentIssuedMunicipalityId`.

Aggiungi loader prefetch alle relative route.

- [ ] **Step 3: Typecheck e smoke**

```bash
bun run --filter @bibs/seller typecheck
bun run dev:seller
```

Smoke su `/onboarding/personal-info` e `/onboarding/document`.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/routes/ apps/seller/src/features/
git commit -m "feat(seller): personal-info & document forms use MunicipalityCombobox"
```

---

### Task 17: Final verification

**Files:** nessuna modifica diretta.

- [ ] **Step 1: Reset + seed end-to-end**

```bash
bun run infra:reset && bun run db:migrate && bun run db:seed
```

Expected: tutto verde.

- [ ] **Step 2: Typecheck root**

```bash
bun run typecheck
```

Expected: PASS su tutti i workspace.

- [ ] **Step 3: Lint**

```bash
bun run lint
```

Expected: PASS o solo warning noti.

- [ ] **Step 4: Test API**

```bash
cd apps/api && bun test
```

Expected: tutti i test verdi (compresi i 4 nuovi su `listAllMunicipalities`).

- [ ] **Step 5: Smoke API**

```bash
bun run dev:api
```

In un altro terminale:

```bash
curl -s http://localhost:3000/locations/municipalities/all | jq '.data | length'
```

Expected: numero tra 7000 e 8500.

```bash
curl -s -I http://localhost:3000/locations/municipalities/all | grep -i cache-control
```

Expected: `cache-control: public, max-age=86400, stale-while-revalidate=604800`.

Chiudi il server.

- [ ] **Step 6: Smoke UI completo**

```bash
bun run dev:seller
```

Per ogni form (onboarding/company, store create, settings/profile, onboarding/personal-info, onboarding/document):
- Apri la route.
- Verifica zero flash "Caricamento comuni…" (loader prefetch funziona).
- Digita una query con accento: `citta` matcha `Città di Castello`.
- Digita sigla provincia: `(mi` matcha Milano.
- Digita query corta `a`: vedi cap 50 + footer "altri N risultati".
- Seleziona un comune, submit.
- Network panel: body contiene `municipalityId` UUID.
- DB check: la riga corrispondente ha il `municipality_id` corretto.
- Edit di un record esistente: il Combobox mostra il valore già selezionato come `Nome (XX)`.

- [ ] **Step 7: Branch ready**

```bash
git log feat/municipality-combobox --oneline ^main
```

Expected: una catena pulita di commit `feat(...)` + `docs(specs): …`.

- [ ] **Step 8: Commit eventuali fix residui se emersi durante lo smoke**

Solo se serve.

---

## Self-Review Notes (compilata dall'autore)

**Spec coverage check:**
- [x] §3 Architettura → Task 4 (componente) + Task 12 (hook) + Task 1-3 (endpoint API)
- [x] §4.1 Endpoint nuovo → Task 1-3
- [x] §4.2 Schema DB migration → Task 5-6
- [x] §4.3 Schemi forms TypeBox → Task 10
- [x] §4.4 Service layer → Task 7-9
- [x] §4.5 Seed → Task 11
- [x] §5.1 Componente MunicipalityCombobox → Task 4
- [x] §5.2 Hook → Task 12
- [x] §5.3 Integrazione react-hook-form → Task 13-16
- [x] §5.4 Form da riscrivere → Task 13 (company), 14 (store), 15 (profile), 16 (personal-info + document — aggiunti perché toccano `residenceMunicipalityId` e `documentIssuedMunicipalityId` che lo spec §4.2 elenca esplicitamente nello schema DB)
- [x] §5.5 Prefetch → step 4 in ogni task di refactor
- [x] §5.6 i18n → label hardcoded italiane coerenti col resto del codebase (Paraglide non usato in questi form, verificato leggendo il file)
- [x] §6 Test & verification → Task 2 (test service) + Task 17 (verification finale)
- [x] §7 Rollout → catena di commit Conventional sul branch `feat/municipality-combobox`
- [x] §8 Out of scope → rispettato (niente virtualization, niente snapshot, niente customer form, niente search server-side)

**Placeholder scan:** nessun "TBD/TODO/implement later". Le note di verifica esatta del path Eden, dell'API Combobox, e dei file service esatti sono giustificate dal fatto che dipendono da struttura concreta del codebase che varia tra workspace.

**Type consistency:**
- `municipalityId: text` (FK) in tutti gli schemi Drizzle (Task 5).
- `MunicipalityCompactSchema = { id, name, provinciaAcronym }` consistentemente nel backend (Task 1) e nei response (Task 7-9).
- `MunicipalityOption = { id, name, provinciaAcronym }` nel frontend (Task 4) coincide via Eden Treaty.
- `municipalitiesQueryOptions()` consistente come queryKey `['municipalities', 'all']` (Task 12, 13, 14, 15).
- `residenceMunicipalityId`, `documentIssuedMunicipalityId` consistentemente nominati in Drizzle (Task 5), TypeBox forms (Task 10) e form components (Task 16).

Plan complete.
