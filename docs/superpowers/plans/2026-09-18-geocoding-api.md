# Geocoding indirizzi (API) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare all'API la capacità di trasformare un testo digitato in suggerimenti
di indirizzo con coordinate e `municipalityId` nostro, dietro un provider
sostituibile e con una cache.

**Architecture:** un modulo di dominio puro (`lib/geocoding/`) con la porta
`GeocodingProvider`, l'adapter Photon, la normalizzazione dei nomi di luogo e la
risoluzione del comune; una tabella di cache chiavata su `(provider, query,
cella-di-bias)`; un service di orchestrazione nel modulo `locations` che decide
quante chiamate fare al provider; un endpoint `GET /locations/geocode`
autenticato e rate-limitato. Nessuna modifica agli endpoint indirizzi: già
accettano `location` e `municipalityId`.

**Tech Stack:** Bun, Elysia, TypeBox, Drizzle (Postgres/PostGIS), `bun:test`,
testcontainers, Photon (OpenStreetMap).

**Spec:** `docs/superpowers/specs/2026-09-18-customer-address-book-design.md`

Questo piano copre **solo la PR 1** della spec. La rubrica nel customer (PR 2) e
il chip dell'origine di ricerca (PR 3) avranno il proprio piano, perché le loro
task dipendono dalle firme che questa PR produce.

## Global Constraints

- **Formattazione:** Biome, **tab** per l'indentazione, **doppi apici** in JS/TS.
  Lefthook formatta in pre-commit; non aggirarlo.
- **File e directory:** kebab-case.
- **Descrizioni OpenAPI in italiano** su ogni route, come il resto della spec.
- **`ServiceError` prende due argomenti** `(status, message)`. Niente terzo
  argomento: il `code` lo determina `ERROR_CODES[status]`.
- **Colonne enumerate:** `text({ enum: [...] })` + CHECK, **non** `pgEnum`.
- **Mai `db:push`** su un branch condiviso: `db:generate` → leggi l'SQL →
  `db:migrate`.
- **I test che toccano `@/db`** devono chiamare `mock.module("@/db", …)` **prima**
  degli import del codice sotto test (Bun issa i mock, ma l'ordine dei file conta).
  Chi importa `@/lib/auth` va importato **dentro** il test con `await import(…)`.
- **Commit:** Conventional Commits, descrizione in minuscolo e imperativa, scope
  `api`. Un commit per task.
- **Verifica:** `bun run typecheck` (root: propaga ai 3 frontend via Eden),
  `bun run lint`, `bun run test`.
- Branch di lavoro: `feat/api-geocoding`, aperto da `main` aggiornato.

---

### Task 1: Tabella di cache `geocoding_lookups`

**Files:**
- Create: `apps/api/src/db/schemas/geocoding.ts`
- Modify: `apps/api/src/db/schemas/index.ts` (aggiungi l'export in ordine alfabetico, fra `employee` e `holiday-definition`)
- Create: `apps/api/src/lib/geocoding/provider.ts`

**Interfaces:**
- Consumes: niente.
- Produces: `geocodingLookup` (tabella Drizzle), e da `provider.ts`:
  `geocodingProviderNames` (tupla `readonly ["photon", "google"]`),
  `GeocodingProviderName`, `GeocodeHit`, `GeocodeSearchOptions`,
  `GeocodingProvider`.

La porta nasce in questo task perché la colonna `results` è tipizzata su
`GeocodeHit[]`: sono un'unità sola.

- [ ] **Step 1: Scrivi la porta del provider**

`apps/api/src/lib/geocoding/provider.ts`:

```ts
/**
 * I provider previsti. Vive qui e non nello schema del DB perché la tabella
 * deriva dalla porta, non il contrario: una sola fonte di verità.
 */
export const geocodingProviderNames = ["photon", "google"] as const;

export type GeocodingProviderName = (typeof geocodingProviderNames)[number];

/** Un risultato del geocoder, già nella nostra forma: nessun GeoJSON in giro. */
export interface GeocodeHit {
	/** Via e civico quando il provider lo conosce, es. `Via Roma 12`. */
	addressLine1: string;
	zipCode: string | null;
	/** PostGIS point: `x` = longitudine, `y` = latitudine. */
	location: { x: number; y: number };
	/** Comune così come lo scrive il provider, prima della risoluzione. */
	rawCity: string | null;
	/** Provincia così come la scrive il provider. */
	rawCounty: string | null;
	/** Riferimento opaco del provider, es. `photon:N7137139871`. Usato per il dedup. */
	providerRef: string;
}

export interface GeocodeSearchOptions {
	limit: number;
	/** Bias di prossimità: sposta *quali* risultati arrivano, non solo il loro ordine. */
	near?: { lat: number; lng: number };
}

export interface GeocodingProvider {
	readonly name: GeocodingProviderName;
	search(q: string, opts: GeocodeSearchOptions): Promise<GeocodeHit[]>;
}
```

- [ ] **Step 2: Scrivi la tabella**

`apps/api/src/db/schemas/geocoding.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import {
	type GeocodeHit,
	geocodingProviderNames,
} from "@/lib/geocoding/provider";

/**
 * Cache delle risposte del geocoder. La chiave include la cella di bias: senza
 * di essa il ranking di un utente a Milano finirebbe servito a un utente a Roma,
 * perché il bias cambia quali risultati il provider restituisce.
 *
 * Non memorizza il `municipalityId`: la risoluzione del comune è deterministica
 * e locale, quindi correggerla non richiede di invalidare la cache.
 */
export const geocodingLookup = pgTable(
	"geocoding_lookups",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		provider: text("provider", { enum: geocodingProviderNames }).notNull(),
		/** Query normalizzata: lowercase, spazi collassati. */
		query: text("query").notNull(),
		/** `45.46,9.19` (2 decimali, ~1,1 km) oppure `-` quando non c'è bias. */
		biasCell: text("bias_cell").notNull(),
		results: jsonb("results").$type<GeocodeHit[]>().notNull(),
		fetchedAt: timestamp("fetched_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		unique("geocoding_lookup_key_unique").on(t.provider, t.query, t.biasCell),
		check(
			"geocoding_provider_valid",
			sql`${t.provider} IN ('photon', 'google')`,
		),
	],
);
```

- [ ] **Step 3: Registra lo schema**

In `apps/api/src/db/schemas/index.ts` aggiungi la riga in ordine alfabetico:

```ts
export * from "./geocoding";
```

- [ ] **Step 4: Genera la migrazione e leggi l'SQL**

Run: `bun run db:generate`
Poi apri il file SQL appena creato in `apps/api/src/db/migrations/` e verifica
che contenga **esattamente** una `CREATE TABLE "geocoding_lookups"`, il
`CONSTRAINT "geocoding_lookup_key_unique" UNIQUE("provider","query","bias_cell")`
e il `CONSTRAINT "geocoding_provider_valid" CHECK`. Nessun `ALTER` su altre
tabelle: se ce ne sono, il tuo schema locale è fuori sync e va sistemato prima
di procedere.

- [ ] **Step 5: Applica la migrazione**

Run: `bun run db:migrate`
Expected: esce 0 senza errori. (Se esce 1 in silenzio, la causa tipica è
`__drizzle_migrations` desincronizzata dal journal.)

- [ ] **Step 6: Typecheck e commit**

```bash
bun run typecheck
git add apps/api/src/db/schemas/geocoding.ts apps/api/src/db/schemas/index.ts apps/api/src/lib/geocoding/provider.ts apps/api/src/db/migrations
git commit -m "feat(api): add geocoding lookup cache table and provider port"
```

---

### Task 2: Normalizzazione dei nomi di luogo

**Files:**
- Create: `apps/api/src/lib/geocoding/normalize.ts`
- Test: `apps/api/tests/unit/geocoding-normalize.test.ts`

**Interfaces:**
- Consumes: niente (funzioni pure).
- Produces: `normalizeQuery(q: string): string`,
  `normalizePlaceName(s: string): string`,
  `placeNameVariants(s: string): string[]`,
  `placeTokens(s: string): string[]`,
  `biasCell(near?: { lat: number; lng: number }): string`.

- [ ] **Step 1: Scrivi il test che falisce**

`apps/api/tests/unit/geocoding-normalize.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	biasCell,
	normalizePlaceName,
	normalizeQuery,
	placeNameVariants,
	placeTokens,
} from "@/lib/geocoding/normalize";

describe("normalizeQuery", () => {
	it("collapses whitespace and lowercases", () => {
		expect(normalizeQuery("  Via  Roma   12 ")).toBe("via roma 12");
	});
});

describe("normalizePlaceName", () => {
	it("strips diacritics", () => {
		expect(normalizePlaceName("Agliè")).toBe("aglie");
	});

	it("turns apostrophes into spaces", () => {
		expect(normalizePlaceName("Sant'Ambrogio di Torino")).toBe(
			"sant ambrogio di torino",
		);
	});

	it("turns hyphens into spaces", () => {
		expect(normalizePlaceName("Pont-Canavese")).toBe("pont canavese");
	});
});

describe("placeNameVariants", () => {
	it("splits a bilingual name written with a spaced hyphen", () => {
		expect(placeNameVariants("Bolzano - Bozen")).toEqual([
			"bolzano bozen",
			"bolzano",
			"bozen",
		]);
	});

	it("splits a bilingual name written with a slash", () => {
		expect(placeNameVariants("Bolzano/Bozen")).toEqual([
			"bolzano bozen",
			"bolzano",
			"bozen",
		]);
	});

	// Un trattino senza spazi non è un bilingue: `Pont-Canavese` non si chiama
	// `Pont`, e indicizzare le metà creerebbe chiavi fantasma.
	it("does NOT split a plain hyphenated name", () => {
		expect(placeNameVariants("Pont-Canavese")).toEqual(["pont canavese"]);
	});
});

describe("placeTokens", () => {
	it("drops filler words so provinces can be compared", () => {
		expect(placeTokens("Monza e della Brianza")).toEqual(["monza", "brianza"]);
	});
});

describe("biasCell", () => {
	it("rounds coordinates into ~1.1km cells", () => {
		expect(biasCell({ lat: 45.4642, lng: 9.19 })).toBe("45.46,9.19");
	});

	it("is a dash when there is no bias", () => {
		expect(biasCell()).toBe("-");
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che falisca**

Run: `cd apps/api && bun test tests/unit/geocoding-normalize.test.ts`
Expected: FAIL — `Cannot find module '@/lib/geocoding/normalize'`.

- [ ] **Step 3: Implementa**

`apps/api/src/lib/geocoding/normalize.ts`:

```ts
const DIACRITICS = /\p{Diacritic}/gu;

/** Parole che non distinguono una provincia da un'altra. */
const FILLER_WORDS = new Set([
	"e",
	"di",
	"del",
	"della",
	"dell",
	"d",
	"in",
	"la",
	"il",
	"provincia",
	"autonoma",
	"citta",
	"metropolitana",
]);

/** La query come la vede la cache: minuscola, senza spazi ridondanti. */
export function normalizeQuery(q: string): string {
	return q.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Nome di luogo confrontabile: senza diacritici, con apostrofi, trattini e
 * slash ridotti a spazio. `Agliè` → `aglie`, `Pont-Canavese` → `pont canavese`.
 */
export function normalizePlaceName(s: string): string {
	return s
		.normalize("NFD")
		.replace(DIACRITICS, "")
		.replace(/['’]/g, " ")
		.replace(/[-/]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/**
 * Varianti confrontabili di un nome: il nome intero più le due metà di un
 * bilingue. Photon scrive `Bolzano - Bozen`, il nostro seed `Bolzano`, e le
 * province `Bolzano/Bozen`. Lo split richiede spazi attorno al trattino,
 * così `Pont-Canavese` resta intero.
 */
export function placeNameVariants(s: string): string[] {
	const parts = s
		.split(/ - |\//g)
		.map((part) => normalizePlaceName(part))
		.filter(Boolean);
	return [...new Set([normalizePlaceName(s), ...parts])];
}

/** Token significativi, per confrontare due modi di scrivere una provincia. */
export function placeTokens(s: string): string[] {
	return normalizePlaceName(s)
		.split(" ")
		.filter((token) => token.length > 0 && !FILLER_WORDS.has(token));
}

/** Celle da ~1,1 km: la parte di bias nella chiave di cache. */
export function biasCell(near?: { lat: number; lng: number }): string {
	if (!near) return "-";
	return `${near.lat.toFixed(2)},${near.lng.toFixed(2)}`;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `cd apps/api && bun test tests/unit/geocoding-normalize.test.ts`
Expected: PASS, 9 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/geocoding/normalize.ts apps/api/tests/unit/geocoding-normalize.test.ts
git commit -m "feat(api): add place-name normalization for geocoding"
```

---

### Task 3: Risoluzione del comune

**Files:**
- Create: `apps/api/src/lib/geocoding/resolve-municipality.ts`
- Test: `apps/api/tests/unit/geocoding-resolve-municipality.test.ts`

**Interfaces:**
- Consumes: `normalizePlaceName`, `placeNameVariants`, `placeTokens` (Task 2).
- Produces: `MunicipalityIndexEntry`, `MunicipalityIndex`, `MunicipalityCompact`,
  `ResolvedMunicipality`, `buildMunicipalityIndex(rows)`,
  `resolveMunicipality(index, hit)`, `toCompact(entry)`.

Perché esiste: `customer_addresses.municipalityId` è una FK obbligatoria verso
`municipalities`. Un risultato del geocoder che non si riconduce a una nostra
riga non è salvabile, e in tutta Italia esistono solo 6 nomi di comune omonimi,
quindi l'ambiguità è un caso raro da gestire senza indovinare.

- [ ] **Step 1: Scrivi il test che falisce**

`apps/api/tests/unit/geocoding-resolve-municipality.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	buildMunicipalityIndex,
	type MunicipalityIndexEntry,
	resolveMunicipality,
} from "@/lib/geocoding/resolve-municipality";

const ROWS: MunicipalityIndexEntry[] = [
	{ id: "m-pioltello", name: "Pioltello", provinceAcronym: "MI", provinceName: "Milano" },
	{ id: "m-bolzano", name: "Bolzano", provinceAcronym: "BZ", provinceName: "Bolzano/Bozen" },
	{ id: "m-aglie", name: "Agliè", provinceAcronym: "TO", provinceName: "Torino" },
	{ id: "m-roma", name: "Roma", provinceAcronym: "RM", provinceName: "Roma" },
	// I due omonimi reali su cui si gioca lo spareggio per provincia.
	{ id: "m-castro-bg", name: "Castro", provinceAcronym: "BG", provinceName: "Bergamo" },
	{ id: "m-castro-le", name: "Castro", provinceAcronym: "LE", provinceName: "Lecce" },
	{ id: "m-livo-co", name: "Livo", provinceAcronym: "CO", provinceName: "Como" },
	{ id: "m-livo-tn", name: "Livo", provinceAcronym: "TN", provinceName: "Trento" },
];

const index = buildMunicipalityIndex(ROWS);

describe("resolveMunicipality", () => {
	it("resolves a unique name", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Pioltello",
			rawCounty: "Milano",
		});
		expect(result.municipality).toEqual({
			id: "m-pioltello",
			name: "Pioltello",
			provinceAcronym: "MI",
		});
		expect(result.candidates).toEqual([]);
	});

	// Photon scrive i comuni altoatesini bilingui, il nostro seed no.
	it("resolves a bilingual city name", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Bolzano - Bozen",
			rawCounty: "Bolzano - Bozen",
		});
		expect(result.municipality?.id).toBe("m-bolzano");
	});

	it("resolves a name with diacritics", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Agliè",
			rawCounty: "Torino",
		});
		expect(result.municipality?.id).toBe("m-aglie");
	});

	// Il `county` del provider è rumoroso: `Roma Capitale` per la nostra `Roma`.
	it("resolves despite a noisy province name", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Roma",
			rawCounty: "Roma Capitale",
		});
		expect(result.municipality?.id).toBe("m-roma");
	});

	it("breaks a homonym tie using the province", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Castro",
			rawCounty: "Lecce",
		});
		expect(result.municipality?.id).toBe("m-castro-le");
		expect(result.candidates).toEqual([]);
	});

	it("breaks a homonym tie on shared province tokens", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Livo",
			rawCounty: "Provincia autonoma di Trento",
		});
		expect(result.municipality?.id).toBe("m-livo-tn");
	});

	it("returns candidates when a homonym cannot be disambiguated", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Castro",
			rawCounty: null,
		});
		expect(result.municipality).toBeNull();
		expect(result.candidates.map((c) => c.id).sort()).toEqual([
			"m-castro-bg",
			"m-castro-le",
		]);
	});

	it("returns candidates when the province matches nothing", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Castro",
			rawCounty: "Provincia Inesistente",
		});
		expect(result.municipality).toBeNull();
		expect(result.candidates).toHaveLength(2);
	});

	it("returns nothing for an unknown city", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Nonesiste",
			rawCounty: "Milano",
		});
		expect(result.municipality).toBeNull();
		expect(result.candidates).toEqual([]);
	});

	it("returns nothing when the provider gave no city", () => {
		const result = resolveMunicipality(index, {
			rawCity: null,
			rawCounty: "Milano",
		});
		expect(result.municipality).toBeNull();
		expect(result.candidates).toEqual([]);
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che falisca**

Run: `cd apps/api && bun test tests/unit/geocoding-resolve-municipality.test.ts`
Expected: FAIL — `Cannot find module '@/lib/geocoding/resolve-municipality'`.

- [ ] **Step 3: Implementa**

`apps/api/src/lib/geocoding/resolve-municipality.ts`:

```ts
import { placeNameVariants, placeTokens } from "./normalize";

export interface MunicipalityIndexEntry {
	id: string;
	name: string;
	provinceAcronym: string;
	provinceName: string;
}

/** Nome normalizzato → righe che lo portano (più di una solo per gli omonimi). */
export type MunicipalityIndex = Map<string, MunicipalityIndexEntry[]>;

/** La forma che l'API espone, identica a `MunicipalityCompactSchema`. */
export interface MunicipalityCompact {
	id: string;
	name: string;
	provinceAcronym: string;
}

export interface ResolvedMunicipality {
	/** Il comune, quando è certo. */
	municipality: MunicipalityCompact | null;
	/** Gli omonimi fra cui deve scegliere il cliente, quando non lo è. */
	candidates: MunicipalityCompact[];
}

export function toCompact(entry: MunicipalityIndexEntry): MunicipalityCompact {
	return {
		id: entry.id,
		name: entry.name,
		provinceAcronym: entry.provinceAcronym,
	};
}

export function buildMunicipalityIndex(
	rows: MunicipalityIndexEntry[],
): MunicipalityIndex {
	const index: MunicipalityIndex = new Map();
	for (const row of rows) {
		for (const key of placeNameVariants(row.name)) {
			const bucket = index.get(key);
			if (bucket) bucket.push(row);
			else index.set(key, [row]);
		}
	}
	return index;
}

/** Quanti token significativi condividono la nostra provincia e quella del provider. */
function provinceOverlap(provinceName: string, rawCounty: string): number {
	const ours = new Set(placeTokens(provinceName));
	return placeTokens(rawCounty).filter((token) => ours.has(token)).length;
}

export function resolveMunicipality(
	index: MunicipalityIndex,
	hit: { rawCity: string | null; rawCounty: string | null },
): ResolvedMunicipality {
	if (!hit.rawCity) return { municipality: null, candidates: [] };

	const byId = new Map<string, MunicipalityIndexEntry>();
	for (const variant of placeNameVariants(hit.rawCity)) {
		for (const entry of index.get(variant) ?? []) byId.set(entry.id, entry);
	}
	const matches = [...byId.values()];

	if (matches.length === 0) return { municipality: null, candidates: [] };
	if (matches.length === 1) {
		return { municipality: toCompact(matches[0]), candidates: [] };
	}

	// Omonimi. La provincia del provider è l'unico spareggio disponibile, ed è
	// scritta in modi che non coincidono coi nostri (`Roma Capitale`,
	// `Provincia autonoma di Trento`): conta i token condivisi e pretendi un
	// vincitore netto, altrimenti chiedi al cliente.
	const county = hit.rawCounty;
	if (county) {
		const scored = matches
			.map((entry) => ({
				entry,
				score: provinceOverlap(entry.provinceName, county),
			}))
			.sort((a, b) => b.score - a.score);
		const best = scored[0];
		const runnerUp = scored[1];
		if (best.score > 0 && best.score > (runnerUp?.score ?? 0)) {
			return { municipality: toCompact(best.entry), candidates: [] };
		}
	}

	return { municipality: null, candidates: matches.map(toCompact) };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `cd apps/api && bun test tests/unit/geocoding-resolve-municipality.test.ts`
Expected: PASS, 10 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/geocoding/resolve-municipality.ts apps/api/tests/unit/geocoding-resolve-municipality.test.ts
git commit -m "feat(api): resolve geocoder cities onto our municipality rows"
```

---

### Task 4: Riconoscere un comune nel testo della query

**Files:**
- Modify: `apps/api/src/lib/geocoding/resolve-municipality.ts` (aggiungi in coda)
- Test: `apps/api/tests/unit/geocoding-query-municipalities.test.ts`

**Interfaces:**
- Consumes: `MunicipalityIndex`, `MunicipalityCompact`, `toCompact` (Task 3),
  `normalizePlaceName` (Task 2).
- Produces: `findMunicipalityNamesInQuery(index, q): MunicipalityCompact[]`.

Perché esiste, ed è il cuore della regola del bias: il bias di prossimità è
necessario (senza, `via roma 12` restituisce risultati a 130 km) ma soffoca gli
indirizzi lontani (`via roma 12 palermo` da Milano restituisce *Via Palermo 12 a
Parma*). La seconda chiamata senza bias deve partire **solo** quando il testo
nomina davvero un comune — e `via roma 12` non nomina Roma: nomina una via.

- [ ] **Step 1: Scrivi il test che falisce**

`apps/api/tests/unit/geocoding-query-municipalities.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	buildMunicipalityIndex,
	findMunicipalityNamesInQuery,
	type MunicipalityIndexEntry,
} from "@/lib/geocoding/resolve-municipality";

const ROWS: MunicipalityIndexEntry[] = [
	{ id: "m-roma", name: "Roma", provinceAcronym: "RM", provinceName: "Roma" },
	{ id: "m-palermo", name: "Palermo", provinceAcronym: "PA", provinceName: "Palermo" },
	{ id: "m-milano", name: "Milano", provinceAcronym: "MI", provinceName: "Milano" },
	{
		id: "m-reggio",
		name: "Reggio nell'Emilia",
		provinceAcronym: "RE",
		provinceName: "Reggio nell'Emilia",
	},
];

const index = buildMunicipalityIndex(ROWS);

describe("findMunicipalityNamesInQuery", () => {
	// Il caso che protegge il bias: qui Roma è una via, non una destinazione.
	it("ignores a municipality name used as a street name", () => {
		expect(findMunicipalityNamesInQuery(index, "via roma 12")).toEqual([]);
	});

	it("ignores it after any street word", () => {
		expect(findMunicipalityNamesInQuery(index, "corso palermo 5")).toEqual([]);
		expect(findMunicipalityNamesInQuery(index, "piazza milano 3")).toEqual([]);
	});

	it("finds a municipality named after the street", () => {
		expect(
			findMunicipalityNamesInQuery(index, "via roma 12 palermo").map((m) => m.id),
		).toEqual(["m-palermo"]);
	});

	it("finds a municipality at the start of the query", () => {
		expect(
			findMunicipalityNamesInQuery(index, "milano via roma 12").map((m) => m.id),
		).toEqual(["m-milano"]);
	});

	it("matches multi-word names", () => {
		expect(
			findMunicipalityNamesInQuery(index, "via emilia 4 reggio nell'emilia").map(
				(m) => m.id,
			),
		).toEqual(["m-reggio"]);
	});

	it("returns an empty list when no municipality is named", () => {
		expect(findMunicipalityNamesInQuery(index, "via garibaldi 7")).toEqual([]);
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che falisca**

Run: `cd apps/api && bun test tests/unit/geocoding-query-municipalities.test.ts`
Expected: FAIL — `findMunicipalityNamesInQuery is not a function`.

- [ ] **Step 3: Implementa**

Aggiungi in coda a `apps/api/src/lib/geocoding/resolve-municipality.ts`, e
aggiorna l'import di `./normalize` in cima al file perché serve anche
`normalizePlaceName`:

```ts
// riga di import in cima al file, sostituisci quella esistente:
// import { normalizePlaceName, placeNameVariants, placeTokens } from "./normalize";

/**
 * Parole che introducono un odonimo. Un nome di comune subito dopo una di
 * queste è una via, non una destinazione: `via roma` non nomina Roma.
 */
const STREET_WORDS = new Set([
	"via",
	"viale",
	"piazza",
	"piazzale",
	"corso",
	"largo",
	"vicolo",
	"strada",
	"stradone",
	"borgo",
	"contrada",
	"lungomare",
	"salita",
	"calle",
	"campo",
	"rotonda",
	"circonvallazione",
	"localita",
	"frazione",
]);

/** Il nome di comune più lungo dell'elenco ISTAT sta sotto le 6 parole. */
const MAX_NAME_WORDS = 5;

/**
 * I comuni nominati nel testo della query. Serve a decidere se affiancare al
 * bias di prossimità una chiamata senza bias: senza questa distinzione, un
 * indirizzo lontano è irraggiungibile, oppure il bias non funziona più.
 */
export function findMunicipalityNamesInQuery(
	index: MunicipalityIndex,
	q: string,
): MunicipalityCompact[] {
	const words = normalizePlaceName(q)
		.split(" ")
		.filter((word) => word.length > 0);
	const found = new Map<string, MunicipalityIndexEntry>();

	for (let i = 0; i < words.length; i++) {
		if (i > 0 && STREET_WORDS.has(words[i - 1])) continue;

		// Dal più lungo al più corto: `reggio nell emilia` prima di `reggio`.
		for (let n = Math.min(MAX_NAME_WORDS, words.length - i); n >= 1; n--) {
			const candidate = words.slice(i, i + n).join(" ");
			const entries = index.get(candidate);
			if (entries) {
				for (const entry of entries) found.set(entry.id, entry);
				break;
			}
		}
	}

	return [...found.values()].map(toCompact);
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `cd apps/api && bun test tests/unit/geocoding-query-municipalities.test.ts tests/unit/geocoding-resolve-municipality.test.ts`
Expected: PASS, 16 test in totale.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/geocoding/resolve-municipality.ts apps/api/tests/unit/geocoding-query-municipalities.test.ts
git commit -m "feat(api): detect municipality mentions in a geocoding query"
```

---

### Task 5: L'adapter Photon

**Files:**
- Create: `apps/api/src/lib/geocoding/photon.ts`
- Create: `apps/api/src/lib/geocoding/index.ts`
- Modify: `apps/api/src/lib/env.ts` (schema + oggetto esportato)
- Modify: `apps/api/.env.example`
- Modify: `apps/api/AGENTS.md` (elenco delle env, dopo `SELLER_APP_URL` alla riga ~647)
- Test: `apps/api/tests/unit/geocoding-photon.test.ts`

**Interfaces:**
- Consumes: `GeocodeHit`, `GeocodeSearchOptions`, `GeocodingProvider` (Task 1).
- Produces: `photonProvider: GeocodingProvider`,
  `getGeocodingProvider(): GeocodingProvider`, e le env
  `GEOCODING_PROVIDER` (default `photon`), `PHOTON_URL`
  (default `https://photon.komoot.io/api`), `GEOCODING_USER_AGENT`.

Fatti verificati sul servizio reale il 2026-09-18, da non riscoprire in
implementazione: `lang=it` **non è supportato** (Photon accetta solo
`default`/`de`/`en`/`fr` e risponde 400); `properties.city` è il comune,
`county` la provincia; `geometry.coordinates` è `[lon, lat]`.

- [ ] **Step 1: Scrivi il test che falisce**

`apps/api/tests/unit/geocoding-photon.test.ts`:

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { photonProvider } from "@/lib/geocoding/photon";
import { ServiceError } from "@/lib/errors";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

/** Cattura l'URL chiamato e risponde con `body`. */
function stubFetch(body: unknown, init: { ok?: boolean } = {}) {
	const calls: string[] = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		calls.push(String(input));
		return {
			ok: init.ok ?? true,
			json: async () => body,
		} as Response;
	}) as typeof fetch;
	return calls;
}

function feature(props: Record<string, unknown>, coords: [number, number]) {
	return { properties: props, geometry: { coordinates: coords } };
}

describe("photonProvider.search", () => {
	it("sends q and limit, and no lang (Photon rejects `it`)", async () => {
		const calls = stubFetch({ features: [] });

		await photonProvider.search("via roma 12", { limit: 5 });

		expect(calls).toHaveLength(1);
		const url = new URL(calls[0]);
		expect(url.searchParams.get("q")).toBe("via roma 12");
		expect(url.searchParams.get("limit")).toBe("5");
		expect(url.searchParams.get("lang")).toBeNull();
		expect(url.searchParams.get("lat")).toBeNull();
	});

	it("sends the proximity bias as lat/lon", async () => {
		const calls = stubFetch({ features: [] });

		await photonProvider.search("via roma 12", {
			limit: 5,
			near: { lat: 45.4642, lng: 9.19 },
		});

		const url = new URL(calls[0]);
		expect(url.searchParams.get("lat")).toBe("45.4642");
		expect(url.searchParams.get("lon")).toBe("9.19");
	});

	it("maps a feature into our hit shape", async () => {
		stubFetch({
			features: [
				feature(
					{
						street: "Via Roma",
						housenumber: "12",
						city: "Pioltello",
						county: "Milano",
						postcode: "20096",
						countrycode: "IT",
						osm_type: "N",
						osm_id: 7137139871,
					},
					[9.3278473, 45.4998571],
				),
			],
		});

		const hits = await photonProvider.search("via roma 12", { limit: 5 });

		expect(hits).toEqual([
			{
				addressLine1: "Via Roma 12",
				zipCode: "20096",
				location: { x: 9.3278473, y: 45.4998571 },
				rawCity: "Pioltello",
				rawCounty: "Milano",
				providerRef: "photon:N7137139871",
			},
		]);
	});

	it("drops results outside Italy", async () => {
		stubFetch({
			features: [
				feature(
					{ street: "Rue de Rome", city: "Paris", countrycode: "FR" },
					[2.35, 48.85],
				),
			],
		});

		expect(await photonProvider.search("rue de rome", { limit: 5 })).toEqual([]);
	});

	it("keeps a street without a housenumber and a missing postcode as null", async () => {
		stubFetch({
			features: [
				feature(
					{
						street: "Via Roma",
						city: "Usseglio",
						county: "Torino",
						countrycode: "IT",
						osm_type: "W",
						osm_id: 42,
					},
					[7.223, 45.232],
				),
			],
		});

		const hits = await photonProvider.search("via roma", { limit: 5 });

		expect(hits[0].addressLine1).toBe("Via Roma");
		expect(hits[0].zipCode).toBeNull();
	});

	it("throws a 503 ServiceError when the provider answers with an error", async () => {
		stubFetch({}, { ok: false });

		await expect(
			photonProvider.search("via roma 12", { limit: 5 }),
		).rejects.toThrow(ServiceError);
	});

	it("throws a 503 ServiceError when the request fails or times out", async () => {
		globalThis.fetch = (async () => {
			throw new Error("The operation timed out.");
		}) as typeof fetch;

		const error = await photonProvider
			.search("via roma 12", { limit: 5 })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ServiceError);
		expect((error as ServiceError).status).toBe(503);
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che falisca**

Run: `cd apps/api && bun test tests/unit/geocoding-photon.test.ts`
Expected: FAIL — `Cannot find module '@/lib/geocoding/photon'`.

- [ ] **Step 3: Aggiungi le env**

In `apps/api/src/lib/env.ts`, dentro `EnvSchema` dopo `STRIPE_DEV_PRICE_ID`:

```ts
	GEOCODING_PROVIDER: t.Optional(t.String()),
	PHOTON_URL: t.Optional(t.String()),
	GEOCODING_USER_AGENT: t.Optional(t.String()),
```

e nell'oggetto `env` esportato, nella stessa posizione:

```ts
	GEOCODING_PROVIDER: process.env.GEOCODING_PROVIDER ?? "photon",
	PHOTON_URL: process.env.PHOTON_URL ?? "https://photon.komoot.io/api",
	// Photon chiede di identificarsi: un contatto reale evita di finire bloccati.
	GEOCODING_USER_AGENT:
		process.env.GEOCODING_USER_AGENT ?? "bibs/1.0 (+https://bibs.it)",
```

In `apps/api/.env.example`, dopo il blocco Stripe:

```dotenv
# Geocoding indirizzi — provider open source di default
# GEOCODING_PROVIDER=photon                          # [photon] photon | google
# PHOTON_URL=https://photon.komoot.io/api            # istanza self-hosted, se serve
# GEOCODING_USER_AGENT=bibs/1.0 (+https://bibs.it)   # identificazione richiesta da Photon
```

In `apps/api/AGENTS.md`, nell'elenco delle env dopo `SELLER_APP_URL`:

```markdown
- `GEOCODING_PROVIDER` — geocoding provider (default `photon`; `google` is not implemented yet)
- `PHOTON_URL` — Photon endpoint (default `https://photon.komoot.io/api`)
- `GEOCODING_USER_AGENT` — User-Agent sent to the geocoding provider (Photon requires identification)
```

- [ ] **Step 4: Implementa l'adapter e la selezione del provider**

`apps/api/src/lib/geocoding/photon.ts`:

```ts
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import type {
	GeocodeHit,
	GeocodeSearchOptions,
	GeocodingProvider,
} from "./provider";

const TIMEOUT_MS = 5_000;
const UNAVAILABLE = "Servizio di ricerca indirizzi non disponibile";

interface PhotonFeature {
	properties: {
		name?: string;
		street?: string;
		housenumber?: string;
		city?: string;
		county?: string;
		postcode?: string;
		countrycode?: string;
		osm_type?: string;
		osm_id?: number;
	};
	geometry: { coordinates: [number, number] };
}

function toHit(feature: PhotonFeature): GeocodeHit | null {
	const p = feature.properties;
	// Il marketplace è italiano: un risultato estero è rumore, non un'opzione.
	if (p.countrycode !== "IT") return null;

	// `street` manca sui POI, dove il nome è l'unica etichetta utile.
	const street = p.street ?? p.name;
	if (!street) return null;

	const [lon, lat] = feature.geometry.coordinates;
	return {
		addressLine1: p.housenumber ? `${street} ${p.housenumber}` : street,
		zipCode: p.postcode ?? null,
		location: { x: lon, y: lat },
		rawCity: p.city ?? null,
		rawCounty: p.county ?? null,
		providerRef: `photon:${p.osm_type ?? "?"}${p.osm_id ?? "?"}`,
	};
}

/**
 * Photon (OpenStreetMap). `lang` non viene inviato: verificato il 2026-09-18
 * che accetta solo `default`/`de`/`en`/`fr` e risponde 400 su `it`.
 */
export const photonProvider: GeocodingProvider = {
	name: "photon",
	async search(q, opts: GeocodeSearchOptions): Promise<GeocodeHit[]> {
		const url = new URL(env.PHOTON_URL);
		url.searchParams.set("q", q);
		url.searchParams.set("limit", String(opts.limit));
		if (opts.near) {
			url.searchParams.set("lat", String(opts.near.lat));
			url.searchParams.set("lon", String(opts.near.lng));
		}

		let response: Response;
		try {
			response = await fetch(url, {
				headers: { "user-agent": env.GEOCODING_USER_AGENT },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			throw new ServiceError(503, UNAVAILABLE);
		}

		if (!response.ok) throw new ServiceError(503, UNAVAILABLE);

		const body = (await response.json()) as { features?: PhotonFeature[] };
		const hits: GeocodeHit[] = [];
		for (const feature of body.features ?? []) {
			const hit = toHit(feature);
			if (hit) hits.push(hit);
		}
		return hits;
	},
};
```

`apps/api/src/lib/geocoding/index.ts`:

```ts
import { env } from "@/lib/env";
import { photonProvider } from "./photon";
import type { GeocodingProvider } from "./provider";

/**
 * Un provider solo, oggi. Il ramo esiste perché in produzione si passerà a
 * Google: un file nuovo e una env, non un refactor dei chiamanti.
 */
export function getGeocodingProvider(): GeocodingProvider {
	switch (env.GEOCODING_PROVIDER) {
		case "photon":
			return photonProvider;
		default:
			throw new Error(
				`GEOCODING_PROVIDER non supportato: ${env.GEOCODING_PROVIDER}`,
			);
	}
}
```

- [ ] **Step 5: Esegui il test e verifica che passi**

Run: `cd apps/api && bun test tests/unit/geocoding-photon.test.ts`
Expected: PASS, 7 test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/geocoding/photon.ts apps/api/src/lib/geocoding/index.ts apps/api/src/lib/env.ts apps/api/.env.example apps/api/AGENTS.md apps/api/tests/unit/geocoding-photon.test.ts
git commit -m "feat(api): add the photon geocoding adapter behind the provider port"
```

---

### Task 6: La cache su DB

**Files:**
- Create: `apps/api/src/lib/geocoding/cache.ts`
- Test: `apps/api/tests/integration/geocoding-cache.test.ts`

**Interfaces:**
- Consumes: `geocodingLookup` (Task 1), `GeocodeHit` (Task 1), `biasCell` (Task 2).
- Produces: `LOOKUP_TTL_MS`, `CachedLookup`,
  `readLookup({ provider, query, biasCell }, now?)`,
  `writeLookup({ provider, query, biasCell, hits })`.

- [ ] **Step 1: Scrivi il test che falisce**

`apps/api/tests/integration/geocoding-cache.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import { count } from "drizzle-orm";
import { geocodingLookup } from "@/db/schemas/geocoding";
import type { GeocodeHit } from "@/lib/geocoding/provider";
import {
	LOOKUP_TTL_MS,
	readLookup,
	writeLookup,
} from "@/lib/geocoding/cache";
import { truncateAll } from "../helpers/cleanup";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

const HIT: GeocodeHit = {
	addressLine1: "Via Roma 12",
	zipCode: "20096",
	location: { x: 9.3278473, y: 45.4998571 },
	rawCity: "Pioltello",
	rawCounty: "Milano",
	providerRef: "photon:N1",
};

// `as const` perché `LookupKey.provider` è l'unione dei provider, non `string`.
const KEY = {
	provider: "photon",
	query: "via roma 12",
	biasCell: "45.46,9.19",
} as const;

describe("geocoding cache", () => {
	it("returns null for a query never seen", async () => {
		expect(await readLookup(KEY)).toBeNull();
	});

	it("round-trips the hits and reports them fresh", async () => {
		await writeLookup({ ...KEY, hits: [HIT] });

		const cached = await readLookup(KEY);

		expect(cached?.hits).toEqual([HIT]);
		expect(cached?.isStale).toBe(false);
	});

	it("reports an entry older than the TTL as stale", async () => {
		await writeLookup({ ...KEY, hits: [HIT] });

		const cached = await readLookup(KEY, Date.now() + LOOKUP_TTL_MS + 1_000);

		expect(cached?.isStale).toBe(true);
		expect(cached?.hits).toEqual([HIT]);
	});

	// La cella di bias è parte della chiave: il ranking di Milano non deve
	// finire servito a chi cerca da Roma.
	it("keeps different bias cells apart", async () => {
		await writeLookup({ ...KEY, hits: [HIT] });

		expect(await readLookup({ ...KEY, biasCell: "41.90,12.50" })).toBeNull();
		expect(await readLookup({ ...KEY, biasCell: "-" })).toBeNull();
	});

	it("upserts instead of piling up rows for the same key", async () => {
		const db = getTestDb();
		await writeLookup({ ...KEY, hits: [HIT] });
		await writeLookup({
			...KEY,
			hits: [{ ...HIT, addressLine1: "Via Roma 14", providerRef: "photon:N2" }],
		});

		const [{ total }] = await db
			.select({ total: count() })
			.from(geocodingLookup);
		const cached = await readLookup(KEY);

		expect(total).toBe(1);
		expect(cached?.hits[0].addressLine1).toBe("Via Roma 14");
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che falisca**

Run: `cd apps/api && bun test tests/integration/geocoding-cache.test.ts --timeout 180000`
Expected: FAIL — `Cannot find module '@/lib/geocoding/cache'`.

- [ ] **Step 3: Implementa**

`apps/api/src/lib/geocoding/cache.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { geocodingLookup } from "@/db/schemas/geocoding";
import type { GeocodeHit, GeocodingProviderName } from "./provider";

/** Un indirizzo non si sposta: trenta giorni sono prudenti, non aggressivi. */
export const LOOKUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedLookup {
	hits: GeocodeHit[];
	/** Oltre il TTL: da rinfrescare, e usabile solo se il provider non risponde. */
	isStale: boolean;
}

interface LookupKey {
	provider: GeocodingProviderName;
	query: string;
	biasCell: string;
}

export async function readLookup(
	key: LookupKey,
	now = Date.now(),
): Promise<CachedLookup | null> {
	const row = await db.query.geocodingLookup.findFirst({
		where: and(
			eq(geocodingLookup.provider, key.provider),
			eq(geocodingLookup.query, key.query),
			eq(geocodingLookup.biasCell, key.biasCell),
		),
	});
	if (!row) return null;

	return {
		hits: row.results,
		isStale: now - row.fetchedAt.getTime() > LOOKUP_TTL_MS,
	};
}

export async function writeLookup(
	params: LookupKey & { hits: GeocodeHit[] },
): Promise<void> {
	const now = new Date();
	await db
		.insert(geocodingLookup)
		.values({
			provider: params.provider,
			query: params.query,
			biasCell: params.biasCell,
			results: params.hits,
			fetchedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				geocodingLookup.provider,
				geocodingLookup.query,
				geocodingLookup.biasCell,
			],
			set: { results: params.hits, fetchedAt: now },
		});
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `cd apps/api && bun test tests/integration/geocoding-cache.test.ts --timeout 180000`
Expected: PASS, 5 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/geocoding/cache.ts apps/api/tests/integration/geocoding-cache.test.ts
git commit -m "feat(api): cache geocoding lookups per query and bias cell"
```

---

### Task 7: L'indice dei comuni caricato dal DB

**Files:**
- Create: `apps/api/src/lib/geocoding/municipality-index.ts`
- Test: `apps/api/tests/integration/geocoding-municipality-index.test.ts`

**Interfaces:**
- Consumes: `buildMunicipalityIndex`, `MunicipalityIndex` (Task 3).
- Produces: `loadMunicipalityIndex(): Promise<MunicipalityIndex>`,
  `resetMunicipalityIndex(): void` (solo per i test).

- [ ] **Step 1: Scrivi il test che falisce**

`apps/api/tests/integration/geocoding-municipality-index.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import {
	loadMunicipalityIndex,
	resetMunicipalityIndex,
} from "@/lib/geocoding/municipality-index";
import { resolveMunicipality } from "@/lib/geocoding/resolve-municipality";
import { truncateAll } from "../helpers/cleanup";
import { createTestMunicipality } from "../helpers/fixtures";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	// L'indice è memoizzato per processo: senza reset, il caso successivo
	// leggerebbe i comuni del caso precedente.
	resetMunicipalityIndex();
});

describe("loadMunicipalityIndex", () => {
	it("indexes the municipalities with their province, ready for resolution", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, {
			municipalityName: "Pioltello",
			provinceName: "Milano",
			provinceAcronym: "MI",
		});

		const index = await loadMunicipalityIndex();
		const resolved = resolveMunicipality(index, {
			rawCity: "Pioltello",
			rawCounty: "Milano",
		});

		expect(resolved.municipality?.name).toBe("Pioltello");
		expect(resolved.municipality?.provinceAcronym).toBe("MI");
	});

	it("builds the index once per process", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, { municipalityName: "Pioltello" });

		const first = await loadMunicipalityIndex();
		const second = await loadMunicipalityIndex();

		expect(second).toBe(first);
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che falisca**

Run: `cd apps/api && bun test tests/integration/geocoding-municipality-index.test.ts --timeout 180000`
Expected: FAIL — `Cannot find module '@/lib/geocoding/municipality-index'`.

- [ ] **Step 3: Implementa**

`apps/api/src/lib/geocoding/municipality-index.ts`:

```ts
import { db } from "@/db";
import {
	buildMunicipalityIndex,
	type MunicipalityIndex,
} from "./resolve-municipality";

let cached: MunicipalityIndex | null = null;
let loading: Promise<MunicipalityIndex> | null = null;

/**
 * I comuni italiani non cambiano durante la vita di un processo: l'indice si
 * costruisce una volta sola. Stesso principio di `/municipalities/all`, che è
 * cacheato 24 h lato HTTP.
 */
export async function loadMunicipalityIndex(): Promise<MunicipalityIndex> {
	if (cached) return cached;
	if (!loading) {
		loading = (async () => {
			const rows = await db.query.municipality.findMany({
				columns: { id: true, name: true },
				with: { province: { columns: { acronym: true, name: true } } },
			});
			const index = buildMunicipalityIndex(
				rows.map((row) => ({
					id: row.id,
					name: row.name,
					provinceAcronym: row.province.acronym,
					provinceName: row.province.name,
				})),
			);
			cached = index;
			loading = null;
			return index;
		})();
	}
	return loading;
}

/** Test-only: svuota l'indice memoizzato fra i casi. */
export function resetMunicipalityIndex(): void {
	cached = null;
	loading = null;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `cd apps/api && bun test tests/integration/geocoding-municipality-index.test.ts --timeout 180000`
Expected: PASS, 2 test.

Se `row.province` risulta `null` in TypeScript, la relazione `municipality →
province` esiste ma è tipizzata come opzionale: controlla
`apps/api/src/db/schemas/location.ts` e usa la stessa forma che usa
`apps/api/src/modules/customer/services/addresses.ts` (`municipalityWith`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/geocoding/municipality-index.ts apps/api/tests/integration/geocoding-municipality-index.test.ts
git commit -m "feat(api): load and memoize the municipality index for geocoding"
```

---

### Task 8: Il service di orchestrazione

**Files:**
- Create: `apps/api/src/modules/locations/services/geocode.ts`
- Test: `apps/api/tests/integration/geocode-service.test.ts`

**Interfaces:**
- Consumes: `getGeocodingProvider` (Task 5), `readLookup`/`writeLookup` (Task 6),
  `loadMunicipalityIndex` (Task 7), `resolveMunicipality` +
  `findMunicipalityNamesInQuery` (Task 3-4), `normalizeQuery`/`biasCell` (Task 2).
- Produces: `GeocodeSuggestion` (interfaccia),
  `geocodeAddress(params: { q: string; limit?: number; lat?: number; lng?: number }): Promise<GeocodeSuggestion[]>`.

Qui vive la regola delle due chiamate misurata nella spec: bias pieno per
default, seconda chiamata senza bias **solo** se il testo nomina un comune, e i
risultati di quel comune in testa.

- [ ] **Step 1: Scrivi il test che falisce**

`apps/api/tests/integration/geocode-service.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

import type { GeocodeHit, GeocodeSearchOptions } from "@/lib/geocoding/provider";

/** Provider finto: registra ogni chiamata e restituisce hit a comando. */
const calls: { q: string; opts: GeocodeSearchOptions }[] = [];
let nextHits: GeocodeHit[] = [];
let failNext = false;

mock.module("@/lib/geocoding", () => ({
	getGeocodingProvider: () => ({
		name: "photon",
		async search(q: string, opts: GeocodeSearchOptions) {
			calls.push({ q, opts });
			if (failNext) throw new Error("provider down");
			return nextHits;
		},
	}),
}));

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import { LOOKUP_TTL_MS, writeLookup } from "@/lib/geocoding/cache";
import { resetMunicipalityIndex } from "@/lib/geocoding/municipality-index";
import { geocodeAddress } from "@/modules/locations/services/geocode";
import { truncateAll } from "../helpers/cleanup";
import { createTestMunicipality } from "../helpers/fixtures";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	resetMunicipalityIndex();
	calls.length = 0;
	nextHits = [];
	failNext = false;
});

function hit(overrides: Partial<GeocodeHit> = {}): GeocodeHit {
	return {
		addressLine1: "Via Roma 12",
		zipCode: "20096",
		location: { x: 9.3278473, y: 45.4998571 },
		rawCity: "Pioltello",
		rawCounty: "Milano",
		providerRef: "photon:N1",
		...overrides,
	};
}

const MILAN = { lat: 45.4642, lng: 9.19 };

describe("geocodeAddress", () => {
	it("returns suggestions with the municipality resolved and a readable label", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, {
			municipalityName: "Pioltello",
			provinceName: "Milano",
			provinceAcronym: "MI",
		});
		nextHits = [hit()];

		const [suggestion] = await geocodeAddress({ q: "Via Roma 12", ...MILAN });

		expect(suggestion.label).toBe("Via Roma 12, Pioltello (MI)");
		expect(suggestion.municipality?.name).toBe("Pioltello");
		expect(suggestion.municipalityCandidates).toEqual([]);
		expect(suggestion.location).toEqual({ x: 9.3278473, y: 45.4998571 });
		expect(suggestion.zipCode).toBe("20096");
	});

	it("labels a suggestion whose municipality we cannot resolve", async () => {
		nextHits = [hit({ rawCity: "Comune Inesistente" })];

		const [suggestion] = await geocodeAddress({ q: "Via Roma 12", ...MILAN });

		expect(suggestion.municipality).toBeNull();
		expect(suggestion.label).toBe("Via Roma 12, Comune Inesistente");
	});

	it("serves the second identical query from the cache", async () => {
		nextHits = [hit()];

		await geocodeAddress({ q: "Via Roma 12", ...MILAN });
		await geocodeAddress({ q: "via  roma 12", ...MILAN });

		expect(calls).toHaveLength(1);
	});

	it("does not reuse a ranking across bias cells", async () => {
		nextHits = [hit()];

		await geocodeAddress({ q: "Via Roma 12", ...MILAN });
		await geocodeAddress({ q: "Via Roma 12", lat: 41.9028, lng: 12.4964 });

		expect(calls).toHaveLength(2);
	});

	// `via roma 12` non nomina Roma: una sola chiamata, col bias.
	it("makes a single biased call when no municipality is named", async () => {
		nextHits = [hit()];

		await geocodeAddress({ q: "Via Roma 12", ...MILAN });

		expect(calls).toHaveLength(1);
		expect(calls[0].opts.near).toEqual(MILAN);
	});

	// `via roma 12 palermo` nomina Palermo: il bias da solo restituirebbe
	// Via Palermo a Parma, quindi parte anche una chiamata senza bias e i
	// risultati di Palermo vanno in testa.
	it("adds an unbiased call and promotes the named municipality", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, {
			municipalityName: "Palermo",
			provinceName: "Palermo",
			provinceAcronym: "PA",
		});
		await createTestMunicipality(db, {
			municipalityName: "Parma",
			provinceName: "Parma",
			provinceAcronym: "PR",
		});

		let call = 0;
		nextHits = [];
		const biased = hit({
			addressLine1: "Via Palermo 12",
			rawCity: "Parma",
			rawCounty: "Parma",
			providerRef: "photon:N-parma",
		});
		const unbiased = hit({
			addressLine1: "Via Roma 12",
			rawCity: "Palermo",
			rawCounty: "Palermo",
			providerRef: "photon:N-palermo",
		});
		mock.module("@/lib/geocoding", () => ({
			getGeocodingProvider: () => ({
				name: "photon",
				async search(q: string, opts: GeocodeSearchOptions) {
					calls.push({ q, opts });
					call += 1;
					return call === 1 ? [biased] : [unbiased];
				},
			}),
		}));

		const suggestions = await geocodeAddress({
			q: "Via Roma 12 Palermo",
			...MILAN,
		});

		expect(calls).toHaveLength(2);
		expect(calls[0].opts.near).toEqual(MILAN);
		expect(calls[1].opts.near).toBeUndefined();
		expect(suggestions[0].municipality?.name).toBe("Palermo");
		expect(suggestions[1].municipality?.name).toBe("Parma");
	});

	it("serves a stale entry when the provider is down", async () => {
		await writeLookup({
			provider: "photon",
			query: "via roma 12",
			biasCell: "45.46,9.19",
			hits: [hit()],
		});
		// Invecchia la entry oltre il TTL agendo sull'orologio del test.
		const realNow = Date.now;
		Date.now = () => realNow() + LOOKUP_TTL_MS + 1_000;
		failNext = true;

		try {
			const suggestions = await geocodeAddress({ q: "Via Roma 12", ...MILAN });
			expect(suggestions).toHaveLength(1);
			expect(suggestions[0].addressLine1).toBe("Via Roma 12");
		} finally {
			Date.now = realNow;
		}
	});

	it("propagates the failure when there is nothing cached", async () => {
		failNext = true;

		await expect(
			geocodeAddress({ q: "Via Roma 12", ...MILAN }),
		).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che falisca**

Run: `cd apps/api && bun test tests/integration/geocode-service.test.ts --timeout 180000`
Expected: FAIL — `Cannot find module '@/modules/locations/services/geocode'`.

- [ ] **Step 3: Implementa**

`apps/api/src/modules/locations/services/geocode.ts`:

```ts
import { biasCell, normalizeQuery } from "@/lib/geocoding/normalize";
import { getGeocodingProvider } from "@/lib/geocoding";
import { loadMunicipalityIndex } from "@/lib/geocoding/municipality-index";
import { readLookup, writeLookup } from "@/lib/geocoding/cache";
import type {
	GeocodeHit,
	GeocodeSearchOptions,
} from "@/lib/geocoding/provider";
import {
	findMunicipalityNamesInQuery,
	type MunicipalityCompact,
	type MunicipalityIndex,
	resolveMunicipality,
} from "@/lib/geocoding/resolve-municipality";

const DEFAULT_LIMIT = 5;

export interface GeocodeSuggestion {
	/** Riga da mostrare, es. `Via Roma 12, Pioltello (MI)`. */
	label: string;
	addressLine1: string;
	zipCode: string | null;
	location: { x: number; y: number };
	municipality: MunicipalityCompact | null;
	/** Omonimi fra cui deve scegliere il cliente. */
	municipalityCandidates: MunicipalityCompact[];
	providerRef: string;
}

export interface GeocodeParams {
	q: string;
	limit?: number;
	lat?: number;
	lng?: number;
}

/** Una chiamata al provider, passando prima dalla cache. */
async function lookup(
	query: string,
	opts: GeocodeSearchOptions,
): Promise<GeocodeHit[]> {
	const provider = getGeocodingProvider();
	const cell = biasCell(opts.near);
	const cached = await readLookup({
		provider: provider.name,
		query,
		biasCell: cell,
	});
	if (cached && !cached.isStale) return cached.hits;

	try {
		const hits = await provider.search(query, opts);
		await writeLookup({
			provider: provider.name,
			query,
			biasCell: cell,
			hits,
		});
		return hits;
	} catch (error) {
		// Stale-if-error: una risposta vecchia è meglio di un form che non cerca.
		if (cached) return cached.hits;
		throw error;
	}
}

function dedupe(hits: GeocodeHit[]): GeocodeHit[] {
	const byRef = new Map<string, GeocodeHit>();
	for (const hit of hits) {
		if (!byRef.has(hit.providerRef)) byRef.set(hit.providerRef, hit);
	}
	return [...byRef.values()];
}

function toSuggestion(
	hit: GeocodeHit,
	index: MunicipalityIndex,
): GeocodeSuggestion {
	const { municipality, candidates } = resolveMunicipality(index, hit);
	const place = municipality
		? `${municipality.name} (${municipality.provinceAcronym})`
		: (hit.rawCity ?? "");

	return {
		label: place ? `${hit.addressLine1}, ${place}` : hit.addressLine1,
		addressLine1: hit.addressLine1,
		zipCode: hit.zipCode,
		location: hit.location,
		municipality,
		municipalityCandidates: candidates,
		providerRef: hit.providerRef,
	};
}

/**
 * Suggerimenti di indirizzo per un testo digitato.
 *
 * Il bias di prossimità è pieno per default: senza, `via roma 12` restituisce
 * risultati a 130 km. Ma il bias soffoca gli indirizzi lontani (`via roma 12
 * palermo` da Milano torna come `Via Palermo 12` a Parma), quindi quando il
 * testo nomina un comune parte anche una chiamata senza bias, e i risultati di
 * quel comune vanno in testa.
 */
export async function geocodeAddress(
	params: GeocodeParams,
): Promise<GeocodeSuggestion[]> {
	const limit = params.limit ?? DEFAULT_LIMIT;
	const query = normalizeQuery(params.q);
	const near =
		params.lat !== undefined && params.lng !== undefined
			? { lat: params.lat, lng: params.lng }
			: undefined;

	const index = await loadMunicipalityIndex();
	const mentionedIds = new Set(
		findMunicipalityNamesInQuery(index, query).map((m) => m.id),
	);

	const biased = near ? await lookup(query, { limit, near }) : [];
	// Senza bias la prima chiamata è già larga: la seconda serve solo quando il
	// bias c'è e il testo nomina un comune che il bias schiaccerebbe.
	const wide =
		!near || mentionedIds.size > 0 ? await lookup(query, { limit }) : [];

	const suggestions = dedupe([...biased, ...wide]).map((hit) =>
		toSuggestion(hit, index),
	);

	if (mentionedIds.size === 0) return suggestions.slice(0, limit);

	const isMentioned = (s: GeocodeSuggestion) =>
		s.municipality !== null && mentionedIds.has(s.municipality.id);

	return [
		...suggestions.filter(isMentioned),
		...suggestions.filter((s) => !isMentioned(s)),
	].slice(0, limit);
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `cd apps/api && bun test tests/integration/geocode-service.test.ts --timeout 180000`
Expected: PASS, 9 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/locations/services/geocode.ts apps/api/tests/integration/geocode-service.test.ts
git commit -m "feat(api): orchestrate geocoding with proximity bias and cache"
```

---

### Task 9: L'endpoint `GET /locations/geocode`

**Files:**
- Modify: `apps/api/src/lib/schemas/entities.ts` (aggiungi `GeocodeSuggestionSchema` dopo `MunicipalityCompactSchema`, riga ~155)
- Modify: `apps/api/src/modules/locations/routes/locations.ts` (nuova route in coda alla catena)
- Modify: `apps/api/src/modules/locations/index.ts` (aggiungi `.use(betterAuth)`)
- Test: `apps/api/tests/integration/locations-geocode-route.test.ts`

**Interfaces:**
- Consumes: `geocodeAddress`, `GeocodeSuggestion` (Task 8), `rateLimit`
  (`@/plugins/rate-limit`), `betterAuth` (`@/plugins/better-auth`).
- Produces: `GeocodeSuggestionSchema` (TypeBox) e la route
  `GET /locations/geocode`, che il frontend consumerà via Eden Treaty.

- [ ] **Step 1: Scrivi il test che falisce**

Il test copre la cosa più facile da dimenticare e più costosa da sbagliare:
che la route **esiga l'autenticazione**. Il percorso autenticato è già coperto a
livello di service (Task 8), come fa il resto della suite; il 429 ha già la sua
suite in `tests/plugins/rate-limit.test.ts`.

`apps/api/tests/integration/locations-geocode-route.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

// ── Lifecycle ─────────────────────────────────────────────────────────────────

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

// `@/lib/auth` costruisce l'adapter Drizzle all'import: va importato DENTRO il
// test, dopo il mock di `@/db`, altrimenti punta al pool reale (ECONNREFUSED).
let app: { handle: (request: Request) => Promise<Response> };

beforeAll(async () => {
	await setupTestContainer();
	const { Elysia } = await import("elysia");
	const { errorHandler } = await import("@/plugins/error-handler");
	const { locationsModule } = await import("@/modules/locations");
	app = new Elysia()
		.state("pino", noopPino)
		.use(errorHandler)
		.use(locationsModule);
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /locations/geocode", () => {
	it("requires authentication", async () => {
		const res = await app.handle(
			new Request("http://localhost/locations/geocode?q=via%20roma%2012"),
		);

		expect(res.status).toBe(401);
	});

	it("keeps the municipality list public", async () => {
		const res = await app.handle(
			new Request("http://localhost/locations/municipalities/all"),
		);

		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che falisca**

Run: `cd apps/api && bun test tests/integration/locations-geocode-route.test.ts --timeout 180000`
Expected: FAIL — il primo caso dà 404 (la route non esiste ancora).

- [ ] **Step 3: Aggiungi lo schema di risposta**

In `apps/api/src/lib/schemas/entities.ts`, subito dopo
`MunicipalityCompactSchema`:

```ts
export const GeocodeSuggestionSchema = t.Object(
	{
		label: t.String({
			description: "Riga leggibile, es. 'Via Roma 12, Pioltello (MI)'",
		}),
		addressLine1: t.String({
			description: "Indirizzo con civico, quando il provider lo conosce",
		}),
		zipCode: t.Nullable(
			t.String({ description: "CAP, se il provider lo restituisce" }),
		),
		location: PointXY,
		municipality: t.Nullable(MunicipalityCompactSchema),
		municipalityCandidates: t.Array(MunicipalityCompactSchema, {
			description:
				"Comuni omonimi fra cui deve scegliere il cliente quando la risoluzione è incerta",
		}),
		providerRef: t.String({
			description: "Riferimento opaco del provider, usato per il dedup",
		}),
	},
	{ description: "Suggerimento di indirizzo geocodificato" },
);
```

- [ ] **Step 4: Aggiungi la route**

In `apps/api/src/modules/locations/routes/locations.ts` aggiorna gli import:

Il file importa già `ok`, `okRes`, `withErrors` e altro da `@/lib/schemas`:
**estendi i blocchi esistenti**, non aggiungerne di nuovi dallo stesso modulo
(Biome segnala gli import duplicati). Il risultato è:

```ts
import { getLogger } from "@/lib/logger";
import {
	CountrySchema,
	GeocodeSuggestionSchema,
	MunicipalityCompactSchema,
	MunicipalitySchema,
	okPageRes,
	okRes,
	ProvinceSchema,
	RegionSchema,
	TooManyRequestsError,
	withErrors,
} from "@/lib/schemas";
import { rateLimit } from "@/plugins/rate-limit";
import { geocodeAddress } from "../services/geocode";
```

e aggiungi la costante sotto gli import:

```ts
const MINUTE = 60_000;
```

e aggiungi la route in coda alla catena, dopo `/municipalities/all`:

```ts
	.get(
		"/geocode",
		async ({ query, store }) => {
			const pino = getLogger(store);
			const data = await geocodeAddress(query);
			pino.info(
				{
					geocodeQuery: query.q,
					hasBias: !!(query.lat && query.lng),
					resultCount: data.length,
					action: "address_geocode",
				},
				"Geocoding indirizzo eseguito",
			);
			return ok(data);
		},
		{
			auth: true,
			query: t.Object({
				q: t.String({
					minLength: 3,
					maxLength: 200,
					description: "Testo dell'indirizzo da cercare",
				}),
				limit: t.Optional(
					t.Number({
						minimum: 1,
						maximum: 10,
						default: 5,
						description: "Numero massimo di suggerimenti (default 5)",
					}),
				),
				lat: t.Optional(
					t.Number({
						minimum: -90,
						maximum: 90,
						description:
							"Latitudine da cui cercare: i risultati vicini vengono primi",
					}),
				),
				lng: t.Optional(
					t.Number({
						minimum: -180,
						maximum: 180,
						description: "Longitudine da cui cercare",
					}),
				),
			}),
			beforeHandle: rateLimit({
				name: "geocode",
				limits: [{ by: "ip", window: MINUTE, max: 30 }],
			}),
			response: withErrors({
				200: okRes(t.Array(GeocodeSuggestionSchema)),
				429: TooManyRequestsError,
			}),
			detail: {
				summary: "Geocoding indirizzo",
				description:
					"Trasforma un testo digitato in suggerimenti di indirizzo con coordinate e comune già risolto sui comuni italiani. Con `lat`/`lng` i risultati vicini vengono primi; se il testo nomina un comune, i risultati di quel comune hanno la precedenza. Richiede autenticazione.",
				tags: ["Locations"],
				security: [{ bearerAuth: [] }],
			},
		},
	)
```

- [ ] **Step 5: Abilita il macro di autenticazione nel modulo**

`apps/api/src/modules/locations/index.ts`:

```ts
import { Elysia } from "elysia";
import { betterAuth } from "@/plugins/better-auth";
import { locationsRoutes } from "./routes/locations";

// `betterAuth` serve per il macro `auth: true` di `/geocode`. Le altre route
// del modulo restano pubbliche: nessun `.guard()` attorno a loro.
export const locationsModule = new Elysia({ prefix: "/locations" })
	.use(betterAuth)
	.use(locationsRoutes);
```

- [ ] **Step 6: Esegui il test e verifica che passi**

Run: `cd apps/api && bun test tests/integration/locations-geocode-route.test.ts --timeout 180000`
Expected: PASS, 2 test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/schemas/entities.ts apps/api/src/modules/locations/routes/locations.ts apps/api/src/modules/locations/index.ts apps/api/tests/integration/locations-geocode-route.test.ts
git commit -m "feat(api): expose GET /locations/geocode for address suggestions"
```

---

### Task 10: Verifica e PR

**Files:** nessuno da modificare, salvo le correzioni che emergono.

- [ ] **Step 1: Verifica completa dal root**

```bash
bun run typecheck
bun run lint
bun run test
```

Expected: tutti e tre a 0. `typecheck` gira anche sui 3 frontend perché Eden
propaga i tipi dell'API: se uno di loro diventa rosso senza che tu l'abbia
toccato, la causa tipica è una copia vecchia di una dipendenza nello store
(`bun install` pulito), non il tuo codice.

- [ ] **Step 2: Controlla che l'OpenAPI rifletta la route**

```bash
cd apps/api && bun run dev
```

In un altro terminale:

```bash
curl -s localhost:3000/openapi/json | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['paths']['/locations/geocode'], indent=2, ensure_ascii=False))"
```

Expected: il metodo `get`, i quattro parametri di query, `security` con
`bearerAuth`, le risposte 200 e 429, e la descrizione in italiano.

- [ ] **Step 3: Prova il percorso reale, una volta**

Con il dev server su, autenticati come cliente del seed
(`customer1@test.com` / `password123`) e chiama l'endpoint dalla stessa sessione
del browser (la console di `localhost:3001` va benissimo):

```js
await fetch("http://localhost:3000/locations/geocode?q=via%20roma%2012&lat=45.4642&lng=9.19", { credentials: "include" }).then((r) => r.json())
```

Expected: cinque suggerimenti `Via Roma 12` dell'area milanese, ognuno con
`municipality` risolto. Poi riprova con `q=via roma 12 palermo` e verifica che i
risultati in provincia di Palermo vengano **primi**. Questo è il requisito che
ha motivato la regola delle due chiamate: se qui non si vede, il resto non conta.

- [ ] **Step 4: Apri la PR**

```bash
git push -u origin feat/api-geocoding
gh pr create --title "feat(api): geocoding indirizzi con provider sostituibile" --body "$(cat <<'BODY'
Prima delle tre PR della rubrica indirizzi customer.

Aggiunge la capability di geocoding: porta `GeocodingProvider` (Photon oggi,
Google in produzione senza toccare i chiamanti), cache su `(provider, query,
cella-di-bias)`, risoluzione del comune sui nostri 7904 comuni, e
`GET /locations/geocode` autenticato e rate-limitato.

Il bias di prossimità è pieno per default, e una seconda chiamata senza bias
parte solo quando il testo nomina un comune: senza bias `via roma 12`
restituisce risultati a 130 km, col bias pieno `via roma 12 palermo` da Milano
restituisce Via Palermo a Parma.

Spec: `docs/superpowers/specs/2026-09-18-customer-address-book-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Note per chi esegue

- **Non toccare gli endpoint indirizzi.** `POST`/`PATCH /customer/addresses`
  accettano già `location` e `municipalityId`: se ti sembra che serva una
  modifica lì, ti è sfuggito qualcosa e vale la pena fermarsi.
- **Non introdurre factory generiche** su route Elysia o plugin better-auth per
  deduplicare: collassano l'inference dei tipi e rompono i client Eden dei 3
  frontend. Helper di servizio e funzioni pure: liberi.
- **`google.ts` non va scritto.** La porta esiste per rendere il passaggio un
  file nuovo, non per averlo adesso.
