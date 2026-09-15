# Vista mappa nella ricerca negozi customer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aggiungere a `/stores` nell'app customer un secondo modo di leggere la stessa ricerca — i negozi su una mappa, con i pin raggruppati in cluster — accanto alla griglia di card attuale.

**Architecture:** un endpoint dedicato `GET /customer/stores/map` restituisce in una sola richiesta tutti i negozi che corrispondono ai filtri correnti (tetto di sicurezza a 500 pin), con il minimo che serve a disegnare un pin e il suo popup. Le condizioni SQL dei filtri vengono estratte in un helper condiviso da lista, facet e mappa, così le tre viste non possono divergere. Sul frontend un search param `view=map` commuta il contenuto della colonna dei risultati fra griglia e mappa; il rail dei filtri resta invariato.

**Tech Stack:** Elysia + TypeBox + Drizzle + PostGIS (API); TanStack Start/Router/Query, react-leaflet 5 + Leaflet 1.9 + react-leaflet-cluster 4, Tailwind v4, paraglide (customer).

**Spec:** `docs/superpowers/specs/2026-09-15-customer-store-map-view-design.md`

## Global Constraints

- **Branch:** `feat/customer-store-map-view`. Mai commit diretti su `main`.
- **Tetto pin:** `MAP_PIN_CAP = 500`. Oltre, `truncated: true`.
- **Tre numeri distinti nella risposta:** `total` (negozi che corrispondono ai filtri, con o senza posizione), `mappable` (quanti hanno `stores.location`), `pins.length` (= `min(mappable, 500)`).
- **Ordinamento pin:** distanza crescente se ci sono `lat`/`lng`, altrimenti nome. Mai rilevanza testuale.
- **Leaflet è DOM-only:** nessun import statico di `leaflet`, `react-leaflet` o `react-leaflet-cluster` in un modulo raggiunto dall'SSR. Solo `lazy()` + mount-gate dentro `Suspense`.
- **Copy IT** per l'utente finale; le chiavi paraglide vanno in `apps/customer/messages/it.json` **e** `en.json` (stesse chiavi in entrambi, o la compilazione paraglide fallisce).
- **Commit message:** Conventional Commits con scope (`feat(api):`, `feat(customer):`, `refactor(api):`), enforced dall'hook `commit-msg`. Ogni commit finisce con:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- **Comandi** (dalla root del repo salvo diverso avviso):
  - API test mirati: `cd apps/api && bun test tests/integration/customer-store-discovery.test.ts`
  - API suite: `cd apps/api && bun test`
  - Typecheck per workspace: `cd apps/<workspace> && bun run typecheck` (mai fidarsi dell'aggregato `--filter '*'`: maschera i fallimenti singoli)
  - Lint: `bunx biome check <paths>`
- I test di integrazione richiedono Docker in esecuzione (testcontainers).

---

## File Structure

**API**

| File | Responsabilità |
|---|---|
| `apps/api/src/modules/customer/services/store-search-conditions.ts` *(nuovo)* | Le condizioni WHERE dei filtri negozio, in un posto solo |
| `apps/api/src/modules/customer/services/store-map.ts` *(nuovo)* | `getStoreMapPins()`: pin + i tre conteggi |
| `apps/api/src/modules/customer/services/store-discovery.ts` *(modifica)* | Usa l'helper condiviso al posto della sua copia |
| `apps/api/src/modules/customer/services/store-facets.ts` *(modifica)* | Idem |
| `apps/api/src/lib/schemas/entities.ts` *(modifica)* | `StoreMapPinSchema`, `StoreMapSchema` |
| `apps/api/src/modules/customer/routes/stores.ts` *(modifica)* | `GET /stores/map` |
| `apps/api/tests/integration/customer-store-discovery.test.ts` *(modifica)* | `describe("getStoreMapPins")` |

**Customer**

| File | Responsabilità |
|---|---|
| `apps/customer/src/features/stores/map-shared.ts` *(nuovo)* | `pinIcon`, `userLocationIcon`, `KeepSizeInSync` — condivisi fra le due mappe |
| `apps/customer/src/features/stores/store-map.tsx` *(modifica)* | Mappa della scheda negozio: importa i pezzi condivisi invece di definirli |
| `apps/customer/src/features/stores/use-store-map.ts` *(nuovo)* | Query dei pin + normalizzazione per la UI |
| `apps/customer/src/features/stores/store-search-map.tsx` *(nuovo)* | La mappa dei risultati: cluster, popup, fit |
| `apps/customer/src/features/stores/store-view-toggle.tsx` *(nuovo)* | Il selettore Lista/Mappa |
| `apps/customer/src/routes/_authenticated/stores/index.tsx` *(modifica)* | Search param `view`, montaggio client-only, stati |
| `apps/customer/messages/{it,en}.json` *(modifica)* | Stringhe nuove |
| `package.json` + `apps/customer/package.json` *(modifica)* | `react-leaflet-cluster`, `leaflet.markercluster`, `@types/leaflet.markercluster` |

---

### Task 1: Condizioni di filtro condivise (refactor puro, nessun cambiamento di comportamento)

`store-discovery.ts:44` e `store-facets.ts:54` costruiscono lo stesso array di condizioni in due copie. La mappa sarebbe la terza. Prima di aggiungerla, si estrae.

**Files:**
- Create: `apps/api/src/modules/customer/services/store-search-conditions.ts`
- Modify: `apps/api/src/modules/customer/services/store-discovery.ts:39-76`
- Modify: `apps/api/src/modules/customer/services/store-facets.ts:49-69`
- Test: `apps/api/tests/integration/customer-store-discovery.test.ts` (esistente, usato come rete di sicurezza — nessun test nuovo)

**Interfaces:**
- Consumes: `publiclyVisibleStore()` da `@/lib/store-visibility`
- Produces: `storeFilterConditions(params: StoreFilterParams): ReturnType<typeof sql>[]` e `interface StoreFilterParams { q?: string; categoryId?: string; macroCategoryId?: string; lat?: number; lng?: number; radius?: number }` da `./store-search-conditions`

- [ ] **Step 1: Fissare il verde di partenza**

Un refactor senza test propri si appoggia a quelli che già coprono le due funzioni. Prima va visto passare.

Run: `cd apps/api && bun test tests/integration/customer-store-discovery.test.ts`
Expected: PASS (tutti i test del file). Se è rosso *prima* di toccare qualcosa, fermati: non è questo il piano che lo rompe.

- [ ] **Step 2: Creare l'helper condiviso**

Create `apps/api/src/modules/customer/services/store-search-conditions.ts`:

```ts
import { sql } from "drizzle-orm";
import { municipality } from "@/db/schemas/location";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { publiclyVisibleStore } from "@/lib/store-visibility";

export interface StoreFilterParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	lat?: number;
	lng?: number;
	/** Raggio in km. Applicato solo se ci sono anche lat/lng. */
	radius?: number;
}

/**
 * Condizioni WHERE condivise da ricerca negozi, facet e mappa: le tre viste
 * rispondono alla stessa domanda ("quali negozi corrispondono a questi
 * filtri?"), e tre copie dello stesso array erano tre occasioni di divergere.
 *
 * `openNow` resta fuori di proposito: i facet hanno bisogno della condizione
 * come pezzo separato per contare quanti negozi *sarebbero* aperti a filtro
 * spento, quindi ogni chiamante compone `openNowCondition()` come gli serve —
 * e questo helper resta sincrono.
 *
 * Richiede il join su `municipality` (la ricerca testuale guarda anche il nome
 * del comune): ogni chiamante lo ha già.
 */
export function storeFilterConditions({
	q,
	categoryId,
	macroCategoryId,
	lat,
	lng,
	radius,
}: StoreFilterParams): ReturnType<typeof sql>[] {
	const conditions: ReturnType<typeof sql>[] = [publiclyVisibleStore()];

	if (q) {
		conditions.push(
			sql`(${store.name} ILIKE ${`%${q}%`} OR ${municipality.name} ILIKE ${`%${q}%`})`,
		);
	}
	// `categoryId` wins over `macroCategoryId`: a leaf already sits inside its
	// macro, so applying both would only ever narrow to the same set.
	if (categoryId) {
		conditions.push(sql`${store.categoryId} = ${categoryId}`);
	} else if (macroCategoryId) {
		conditions.push(
			sql`EXISTS (
				SELECT 1 FROM ${storeCategory} sc
				WHERE sc.id = stores.category_id
					AND sc.macro_category_id = ${macroCategoryId}
			)`,
		);
	}
	if (lat !== undefined && lng !== undefined && radius !== undefined) {
		conditions.push(
			sql`ST_DWithin(
				${store.location}::geography,
				ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
				${radius * 1000}
			)`,
		);
	}

	return conditions;
}
```

- [ ] **Step 3: Far usare l'helper a `searchStores`**

In `apps/api/src/modules/customer/services/store-discovery.ts`, sostituire il blocco che va da `const conditions: ReturnType<typeof sql>[] = [publiclyVisibleStore()];` fino alla riga `const whereClause = sql.join(conditions, sql` AND `);` (esclusa) con:

```ts
	const conditions = storeFilterConditions(params);
	// In SQL e non come post-filtro sulle righe: filtrare dopo la query darebbe
	// un `total` e una paginazione che non corrispondono ai risultati.
	if (openNow) {
		conditions.push(await openNowCondition(new Date()));
	}
```

Aggiornare gli import in testa al file: aggiungere `import { storeFilterConditions } from "./store-search-conditions";` e togliere quelli diventati inutilizzati (`storeCategory` resta — serve al `leftJoin`; `publiclyVisibleStore` va rimosso). `noUnusedLocals` fa fallire il typecheck se ne resta uno appeso.

- [ ] **Step 4: Far usare l'helper a `getStoreFacets`**

In `apps/api/src/modules/customer/services/store-facets.ts`, sostituire il blocco delle condizioni (da `const conditions: ReturnType<typeof sql>[] = [publiclyVisibleStore()];` fino alla riga prima del commento `// Il conteggio del toggle "aperti ora"…`) con:

```ts
	// Niente `categoryId`/`macroCategoryId`: i facet rispondono a "quanti negozi
	// restano se aggiungo questo filtro", quindi non applicano mai la categoria
	// già selezionata — altrimenti mostrerebbero solo il ramo aperto.
	const conditions = storeFilterConditions({ q, lat, lng, radius });
```

La variabile `hasGeo` locale diventa inutilizzata: rimuoverla insieme a `const { q, lat, lng, radius, openNow } = params;` che resta invariato. Aggiornare gli import: `storeFilterConditions` dentro, `publiclyVisibleStore` fuori (e `store`/`municipality` restano, li usano i join e i `groupBy`).

- [ ] **Step 5: Verificare che il comportamento non sia cambiato**

Run: `cd apps/api && bun test tests/integration/customer-store-discovery.test.ts`
Expected: PASS, lo stesso numero di test dello Step 1.

Run: `cd apps/api && bun run typecheck`
Expected: nessun errore (in particolare nessun `declared but never read`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/customer/services/store-search-conditions.ts \
        apps/api/src/modules/customer/services/store-discovery.ts \
        apps/api/src/modules/customer/services/store-facets.ts
git commit -m "$(cat <<'EOF'
refactor(api): estrai le condizioni di filtro dei negozi in un helper

Ricerca e facet ne tenevano due copie; la mappa sarebbe la terza. Un
posto solo, cosi' le viste non possono divergere. openNow resta fuori:
i facet lo usano anche separato, per contare quanti sarebbero aperti.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Schemi e servizio dei pin

**Files:**
- Modify: `apps/api/src/lib/schemas/entities.ts:686-703` (subito dopo `StoreCardSchema`)
- Create: `apps/api/src/modules/customer/services/store-map.ts`
- Test: `apps/api/tests/integration/customer-store-discovery.test.ts` (in fondo al file)

**Interfaces:**
- Consumes: `storeFilterConditions()` (Task 1); `openNowCondition()`, `resolveOpenStatuses()` da `@/lib/store-open-status`; `MunicipalityCompactSchema`, `OpenStatusSchema` già in `entities.ts`
- Produces:
  - `MAP_PIN_CAP = 500`
  - `getStoreMapPins(params: StoreMapParams, cap?: number): Promise<StoreMapResult>`
  - `interface StoreMapParams extends StoreFilterParams { openNow?: boolean }`
  - `interface StoreMapResult { pins: StoreMapPin[]; total: number; mappable: number; truncated: boolean }`
  - `interface StoreMapPin { id: string; name: string; coordinates: { lat: number; lng: number }; category: { id: string; name: string } | null; municipality: { id: string; name: string; provinceAcronym: string }; distance: number | null; image: { url: string } | null; openStatus: OpenStatus }`
  - `StoreMapPinSchema`, `StoreMapSchema` da `@/lib/schemas` (riesportati da `entities.ts`)

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `apps/api/tests/integration/customer-store-discovery.test.ts`. Il file ha già `visibleStore()`, `ROME`, `MILAN`, `getTestDb()` e il `beforeEach` che pulisce: si riusano.

```ts
describe("getStoreMapPins", () => {
	it("restituisce gli stessi negozi della lista, con le coordinate", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const a = await visibleStore(seller.profile.id, {
			name: "Bottega A",
			lat: ROME.lat,
			lng: ROME.lng,
		});
		const b = await visibleStore(seller.profile.id, {
			name: "Bottega B",
			lat: MILAN.lat,
			lng: MILAN.lng,
		});

		const list = await searchStores({ limit: 100 });
		const map = await getStoreMapPins({});

		expect(new Set(map.pins.map((p) => p.id))).toEqual(
			new Set(list.data.map((s) => s.id)),
		);
		expect(map.total).toBe(list.pagination.total);
		expect(map.mappable).toBe(2);
		expect(map.truncated).toBe(false);

		const pinA = map.pins.find((p) => p.id === a.id);
		expect(pinA?.coordinates.lat).toBeCloseTo(ROME.lat, 5);
		expect(pinA?.coordinates.lng).toBeCloseTo(ROME.lng, 5);
		expect(map.pins.find((p) => p.id === b.id)?.coordinates.lat).toBeCloseTo(
			MILAN.lat,
			5,
		);
	});

	it("tiene i negozi senza posizione fuori dai pin ma dentro total", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await visibleStore(seller.profile.id, {
			name: "Con posizione",
			lat: ROME.lat,
			lng: ROME.lng,
		});
		const senzaPosizione = await visibleStore(seller.profile.id, {
			name: "Senza posizione",
			noLocation: true,
		});

		const map = await getStoreMapPins({});

		expect(map.total).toBe(2);
		expect(map.mappable).toBe(1);
		expect(map.pins).toHaveLength(1);
		expect(map.pins.map((p) => p.id)).not.toContain(senzaPosizione.id);
	});

	it("esclude i negozi non pubblicamente visibili", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const visibile = await visibleStore(seller.profile.id, {
			name: "Visibile",
		});
		// Nessun abbonamento: fuori dalla vetrina pubblica, quindi fuori dalla mappa.
		await createTestStore(db, seller.profile.id, { name: "Senza abbonamento" });

		const map = await getStoreMapPins({});

		expect(map.pins.map((p) => p.id)).toEqual([visibile.id]);
		expect(map.total).toBe(1);
	});

	it("applica categoria, raggio e testo come la lista", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const categoria = await createTestStoreCategory(db, "Panetterie");
		const altra = await createTestStoreCategory(db, "Ferramenta");
		const panetteria = await visibleStore(seller.profile.id, {
			name: "Pane e Co",
			categoryId: categoria.id,
			lat: ROME.lat,
			lng: ROME.lng,
		});
		await visibleStore(seller.profile.id, {
			name: "Chiodi e Co",
			categoryId: altra.id,
			lat: ROME.lat,
			lng: ROME.lng,
		});
		await visibleStore(seller.profile.id, {
			name: "Pane lontano",
			categoryId: categoria.id,
			lat: MILAN.lat,
			lng: MILAN.lng,
		});

		const perCategoria = await getStoreMapPins({ categoryId: categoria.id });
		expect(perCategoria.pins).toHaveLength(2);

		const vicino = await getStoreMapPins({
			categoryId: categoria.id,
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 50,
		});
		expect(vicino.pins.map((p) => p.id)).toEqual([panetteria.id]);
		expect(vicino.total).toBe(1);

		const perTesto = await getStoreMapPins({ q: "Chiodi" });
		expect(perTesto.pins).toHaveLength(1);
		expect(perTesto.pins[0].name).toBe("Chiodi e Co");
	});

	it("ordina per distanza quando c'è la posizione e tronca al tetto", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		// Tre negozi a distanza crescente da Roma.
		const vicino = await visibleStore(seller.profile.id, {
			name: "Vicino",
			lat: ROME.lat,
			lng: ROME.lng,
		});
		const medio = await visibleStore(seller.profile.id, {
			name: "Medio",
			lat: ROME.lat + 0.1,
			lng: ROME.lng,
		});
		await visibleStore(seller.profile.id, {
			name: "Lontano",
			lat: MILAN.lat,
			lng: MILAN.lng,
		});

		const tutti = await getStoreMapPins({ lat: ROME.lat, lng: ROME.lng });
		expect(tutti.pins.map((p) => p.name)).toEqual(["Vicino", "Medio", "Lontano"]);
		expect(tutti.pins[0].distance).toBeLessThan(tutti.pins[2].distance as number);

		// La distanza è lo stesso numero che la lista mostra sulla card: due
		// formule diverse per lo stesso metro sarebbero due viste in disaccordo.
		const list = await searchStores({
			lat: ROME.lat,
			lng: ROME.lng,
			limit: 100,
		});
		for (const pin of tutti.pins) {
			const card = list.data.find((s) => s.id === pin.id);
			expect(pin.distance).toBeCloseTo(card?.distance as number, 3);
		}

		// Il tetto è iniettabile per non dover inserire 501 negozi in un test.
		const troncati = await getStoreMapPins({ lat: ROME.lat, lng: ROME.lng }, 2);
		expect(troncati.pins.map((p) => p.id)).toEqual([vicino.id, medio.id]);
		expect(troncati.truncated).toBe(true);
		expect(troncati.total).toBe(3);
		expect(troncati.mappable).toBe(3);
	});

	it("ordina per nome quando non c'è la posizione", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await visibleStore(seller.profile.id, { name: "Zeta" });
		await visibleStore(seller.profile.id, { name: "Alfa" });

		const map = await getStoreMapPins({});

		expect(map.pins.map((p) => p.name)).toEqual(["Alfa", "Zeta"]);
		expect(map.pins.every((p) => p.distance === null)).toBe(true);
	});
});
```

Aggiungere in testa al file, accanto agli import esistenti:

```ts
import { getStoreMapPins } from "@/modules/customer/services/store-map";
```

`createTestStore` e `createTestStoreCategory` sono già importati dal file; se uno dei due manca, aggiungerlo alla lista di import da `../helpers/fixtures`.

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `cd apps/api && bun test tests/integration/customer-store-discovery.test.ts`
Expected: FAIL — `Cannot find module '@/modules/customer/services/store-map'`.

- [ ] **Step 3: Aggiungere gli schemi TypeBox**

In `apps/api/src/lib/schemas/entities.ts`, subito dopo la chiusura di `StoreCardSchema` (riga 703):

```ts
export const StoreMapPinSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome del negozio" }),
	coordinates: t.Object({
		lat: t.Number({ description: "Latitudine" }),
		lng: t.Number({ description: "Longitudine" }),
	}),
	category: t.Nullable(t.Object({ id: t.String(), name: t.String() })),
	municipality: MunicipalityCompactSchema,
	distance: t.Nullable(
		t.Number({
			minimum: 0,
			description:
				"Distanza in metri dalla posizione utente (null senza geo)",
		}),
	),
	image: t.Nullable(
		t.Object({ url: t.String({ description: "URL immagine principale" }) }),
	),
	openStatus: OpenStatusSchema,
});

export const StoreMapSchema = t.Object({
	pins: t.Array(StoreMapPinSchema),
	total: t.Integer({
		description:
			"Negozi che corrispondono ai filtri, con o senza posizione: lo stesso numero della lista",
	}),
	mappable: t.Integer({
		description: "Quanti di quei negozi hanno una posizione sulla mappa",
	}),
	truncated: t.Boolean({
		description: "true quando i negozi mappabili superano il tetto di 500 pin",
	}),
});
```

Verificare che `apps/api/src/lib/schemas/index.ts` riesporti `entities.ts` con `export *` (lo fa già per `StoreCardSchema`): se l'export è esplicito nome per nome, aggiungere i due nuovi.

- [ ] **Step 4: Scrivere il servizio**

Create `apps/api/src/modules/customer/services/store-map.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { storeImage } from "@/db/schemas/store-image";
import type {
	CustomClosure,
	OpeningHoursDay,
	OpenStatus,
} from "@/lib/holidays";
import { openNowCondition, resolveOpenStatuses } from "@/lib/store-open-status";
import type { StoreFilterParams } from "./store-search-conditions";
import { storeFilterConditions } from "./store-search-conditions";

/**
 * Tetto di sicurezza ai pin di una singola risposta. Il clustering regge la
 * densità visiva; questo protegge il payload. Oltre il tetto la UI lo dichiara
 * invece di mostrare in silenzio una mappa parziale.
 */
export const MAP_PIN_CAP = 500;

export interface StoreMapParams extends StoreFilterParams {
	openNow?: boolean;
}

export interface StoreMapPin {
	id: string;
	name: string;
	coordinates: { lat: number; lng: number };
	category: { id: string; name: string } | null;
	municipality: { id: string; name: string; provinceAcronym: string };
	distance: number | null;
	image: { url: string } | null;
	openStatus: OpenStatus;
}

export interface StoreMapResult {
	pins: StoreMapPin[];
	/** Negozi che corrispondono ai filtri, mappabili o no. */
	total: number;
	/** Quanti di quelli hanno una posizione. */
	mappable: number;
	truncated: boolean;
}

/**
 * I pin della vista mappa: gli stessi negozi che la lista mostrerebbe, tutti in
 * una risposta invece che a pagine — su una mappa i risultati non si scorrono.
 *
 * `cap` è iniettabile solo per i test: in produzione resta `MAP_PIN_CAP`.
 */
export async function getStoreMapPins(
	params: StoreMapParams,
	cap: number = MAP_PIN_CAP,
): Promise<StoreMapResult> {
	const { lat, lng, openNow } = params;
	const hasGeo = lat !== undefined && lng !== undefined;

	const conditions = storeFilterConditions(params);
	if (openNow) {
		conditions.push(await openNowCondition(new Date()));
	}

	const whereClause = sql.join(conditions, sql` AND `);
	// I pin richiedono una posizione; `total` no. La differenza fra i due è
	// esattamente ciò che la UI dichiara all'utente.
	const mappableClause = sql.join(
		[...conditions, sql`stores.location IS NOT NULL`],
		sql` AND `,
	);

	// In a SELECT-field sql template Drizzle renders interpolated Columns
	// UNqualified, so reference the table literally (`stores.location`).
	const distanceExpr = hasGeo
		? sql`ST_Distance(
				stores.location::geography,
				ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
			)`
		: sql`NULL`;

	// Nessun NULLS LAST: il WHERE dei pin ha già escluso chi non ha posizione.
	const orderExpr = hasGeo
		? sql`distance ASC, ${store.name} ASC, ${store.id} ASC`
		: sql`${store.name} ASC, ${store.id} ASC`;

	const countStores = (where: ReturnType<typeof sql>) =>
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(store)
			.innerJoin(
				municipality,
				sql`${municipality.id} = ${store.municipalityId}`,
			)
			.where(where);

	const [rows, [{ total }], [{ total: mappable }]] = await Promise.all([
		db
			.select({
				id: store.id,
				name: store.name,
				location: store.location,
				openingHours: store.openingHours,
				closures: store.closures,
				categoryId: store.categoryId,
				categoryName: storeCategory.name,
				municipalityId: municipality.id,
				municipalityName: municipality.name,
				provinceAcronym: province.acronym,
				distance: sql<number | null>`${distanceExpr}`.as("distance"),
				imageUrl: sql<string | null>`(
					SELECT si.url FROM ${storeImage} si
					WHERE si.store_id = stores.id
					ORDER BY si.position ASC
					LIMIT 1
				)`.as("image_url"),
			})
			.from(store)
			.innerJoin(
				municipality,
				sql`${municipality.id} = ${store.municipalityId}`,
			)
			.innerJoin(province, sql`${province.id} = ${municipality.provinceId}`)
			.leftJoin(storeCategory, sql`${storeCategory.id} = ${store.categoryId}`)
			.where(mappableClause)
			.orderBy(orderExpr)
			.limit(cap),
		countStores(whereClause),
		countStores(mappableClause),
	]);

	const statusMap = await resolveOpenStatuses(
		rows.map((r) => ({
			id: r.id,
			openingHours: r.openingHours as OpeningHoursDay[] | null,
			closures: r.closures as CustomClosure[] | null,
		})),
		new Date(),
	);

	const pins: StoreMapPin[] = rows.flatMap((r) => {
		// Il WHERE lo garantisce già: questo restringe il tipo, non i dati.
		if (!r.location) return [];
		return [
			{
				id: r.id,
				name: r.name,
				coordinates: { lat: r.location.y, lng: r.location.x },
				category:
					r.categoryId && r.categoryName
						? { id: r.categoryId, name: r.categoryName }
						: null,
				municipality: {
					id: r.municipalityId,
					name: r.municipalityName,
					provinceAcronym: r.provinceAcronym,
				},
				distance: r.distance,
				image: r.imageUrl ? { url: r.imageUrl } : null,
				openStatus: statusMap.get(r.id) ?? { isOpen: false, status: "closed" },
			},
		];
	});

	return { pins, total, mappable, truncated: mappable > cap };
}
```

- [ ] **Step 5: Eseguire i test e vederli passare**

Run: `cd apps/api && bun test tests/integration/customer-store-discovery.test.ts`
Expected: PASS, inclusi i 6 test nuovi di `getStoreMapPins`.

Run: `cd apps/api && bun run typecheck`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/schemas/entities.ts \
        apps/api/src/modules/customer/services/store-map.ts \
        apps/api/tests/integration/customer-store-discovery.test.ts
git commit -m "$(cat <<'EOF'
feat(api): servizio dei pin mappa per la ricerca negozi

getStoreMapPins restituisce in un colpo i negozi che corrispondono ai
filtri (tetto 500), con total, mappable e truncated distinti: sulla
mappa i risultati non si scorrono, e i negozi senza posizione contano
nel totale ma non fra i pin.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Endpoint `GET /customer/stores/map`

**Files:**
- Modify: `apps/api/src/modules/customer/routes/stores.ts:51-86` (fra `/stores/facets` e `/stores/:id`)

**Interfaces:**
- Consumes: `getStoreMapPins()` (Task 2), `StoreMapSchema` (Task 2), `StoreSearchQuery` da `@/lib/queries`, `ok()`, `okRes()`, `withErrors()`
- Produces: la route `/customer/stores/map`, cioè `api().customer.stores.map.get({ query })` lato Eden (usata nel Task 5)

- [ ] **Step 1: Aggiungere la route**

In `apps/api/src/modules/customer/routes/stores.ts`, **dopo** il blocco `.get("/stores/facets", …)` e **prima** di `.get("/stores/:id", …)`:

```ts
	.get(
		"/stores/map",
		async ({ query, store }) => {
			const pino = getLogger(store);
			const result = await getStoreMapPins(query);
			pino.info(
				{
					searchQuery: query.q,
					categoryId: query.categoryId,
					macroCategoryId: query.macroCategoryId,
					hasGeoFilter: !!(query.lat && query.lng),
					radius: query.radius,
					openNow: query.openNow,
					pinCount: result.pins.length,
					total: result.total,
					truncated: result.truncated,
					action: "store_map",
				},
				"Pin mappa negozi richiesti",
			);
			return ok(result);
		},
		{
			query: t.Omit(StoreSearchQuery, ["page", "limit"]),
			response: withErrors({ 200: okRes(StoreMapSchema) }),
			detail: {
				summary: "Pin mappa negozi",
				description:
					"Tutti i negozi che corrispondono ai filtri, con le coordinate, per la vista mappa. Non paginato: una mappa non si scorre a pagine. Restituisce al massimo 500 pin (`truncated: true` oltre quella soglia) ordinati per distanza quando `lat`/`lng` sono presenti, altrimenti per nome. `total` conta anche i negozi senza posizione, che non compaiono fra i pin. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	)
```

Aggiornare gli import in testa al file: `StoreMapSchema` nella lista da `@/lib/schemas`, e `import { getStoreMapPins } from "../services/store-map";` accanto agli altri servizi.

- [ ] **Step 2: Verificare tipi e lint**

Run: `cd apps/api && bun run typecheck`
Expected: nessun errore.

Run: `bunx biome check apps/api/src/modules/customer/routes/stores.ts`
Expected: nessun errore (l'hook pre-commit lo rieseguirà comunque).

- [ ] **Step 3: Provare l'endpoint vivo**

Avviare l'API (`cd apps/api && bun run dev`, porta 3000) con il DB di sviluppo su e i dati seminati, poi:

```bash
curl -s "http://localhost:3000/customer/stores/map?limit=1" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print(len(d['pins']))"
```
Expected: lo stesso numero di pin della chiamata senza `limit` (vedi sotto). Elysia ignora i parametri di query non dichiarati invece di rifiutarli, quindi la prova che `t.Omit` funziona è che `limit` non ha effetto — non un 422.

```bash
curl -s "http://localhost:3000/customer/stores/map" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print(d['total'], d['mappable'], len(d['pins']), d['truncated']); print(d['pins'][0])"
```
Expected: tre numeri coerenti (`len(pins) == min(mappable, 500)`) e un pin con `coordinates`, `openStatus` e `municipality` popolati.

```bash
curl -s "http://localhost:3000/customer/stores" | python3 -c "import json,sys; print(json.load(sys.stdin)['pagination']['total'])"
```
Expected: lo stesso `total` della chiamata mappa.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/customer/routes/stores.ts
git commit -m "$(cat <<'EOF'
feat(api): esponi GET /customer/stores/map

Stessa query dei filtri senza paginazione, registrata prima di
/stores/:id come gia' fa /stores/facets.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dipendenze del clustering e pezzi Leaflet condivisi

**Files:**
- Modify: `package.json` (catalog alla root)
- Modify: `apps/customer/package.json`
- Create: `apps/customer/src/features/stores/map-shared.ts`
- Modify: `apps/customer/src/features/stores/store-map.tsx:1-28`

**Interfaces:**
- Produces: `pinIcon`, `userLocationIcon`, `KeepSizeInSync` da `@/features/stores/map-shared`; `MarkerClusterGroup` (default export di `react-leaflet-cluster`) disponibile al Task 6

- [ ] **Step 1: Aggiungere le dipendenze al catalog**

In `package.json` alla root, dentro il blocco `catalog`, in ordine alfabetico:

```json
		"@types/leaflet.markercluster": "^1.5.6",
		"leaflet.markercluster": "^1.5.3",
		"react-leaflet-cluster": "^4.1.3",
```

`@types/leaflet.markercluster` non è opzionale: i tipi di `react-leaflet-cluster` dichiarano `L.MarkerClusterGroupOptions`, che esiste solo se quel pacchetto di tipi aumenta il modulo `leaflet`. Senza, il typecheck del customer fallisce.

`leaflet.markercluster` è già una dipendenza di `react-leaflet-cluster`, ma va dichiarato esplicitamente perché è nostro il codice che ne importa il CSS.

- [ ] **Step 2: Dichiararle nell'app customer**

In `apps/customer/package.json`, in `dependencies` (ordine alfabetico, accanto a `leaflet`):

```json
		"leaflet.markercluster": "catalog:",
		"react-leaflet-cluster": "catalog:",
```

e in `devDependencies`, accanto a `@types/leaflet`:

```json
		"@types/leaflet.markercluster": "catalog:",
```

- [ ] **Step 3: Installare e leggere l'output**

Run: `bun install`
Expected: installazione pulita. Leggere l'output: se compare un warning di peer dependency non soddisfatta per `@react-leaflet/core`, aggiungerlo al catalog (`"@react-leaflet/core": "^3.0.0"`) e alle dipendenze del customer (`"@react-leaflet/core": "catalog:"`), poi rilanciare `bun install`. Se non compare, non aggiungerlo.

Nota: `bun install` può potare pacchetti opzionali non correlati — è normale. Ciò che non deve succedere è che `bun.lock` mostri modifiche a versioni di pacchetti che non c'entrano con questo task; in quel caso fermarsi e segnalarlo.

- [ ] **Step 4: Estrarre i pezzi Leaflet condivisi**

Create `apps/customer/src/features/stores/map-shared.ts`:

```ts
import L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Pin di un negozio. L'HTML di un `divIcon` vive nel documento, quindi le
 * variabili CSS del brand risolvono e restano theme-aware.
 */
export const pinIcon = L.divIcon({
	className: "",
	html: `<svg width="32" height="40" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C6.48 0 2 4.48 2 10c0 6.5 10 20 10 20s10-13.5 10-20C22 4.48 17.52 0 12 0z" fill="var(--saffron)" stroke="var(--ink)" stroke-width="1.5"/><circle cx="12" cy="10" r="3.2" fill="var(--ink)"/></svg>`,
	iconSize: [32, 40],
	iconAnchor: [16, 40],
});

/**
 * La posizione dell'utente: un punto, non un pin. Non è un negozio e non deve
 * sembrarlo.
 */
export const userLocationIcon = L.divIcon({
	className: "",
	html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:var(--ink);border:2px solid var(--cream);box-shadow:0 1px 3px rgb(0 0 0 / 0.3)"></span>`,
	iconSize: [14, 14],
	iconAnchor: [7, 7],
});

/**
 * Leaflet calcola la dimensione una volta al mount: quando il contenitore
 * cambia larghezza col breakpoint, senza questo la mappa resta con i tile della
 * misura vecchia e una banda grigia.
 */
export function KeepSizeInSync() {
	const map = useMap();
	useEffect(() => {
		const container = map.getContainer();
		const observer = new ResizeObserver(() => map.invalidateSize());
		observer.observe(container);
		return () => observer.disconnect();
	}, [map]);
	return null;
}
```

- [ ] **Step 5: Far usare i pezzi condivisi alla mappa della scheda negozio**

Sostituire l'intera testa di `apps/customer/src/features/stores/store-map.tsx` (righe 1-28, cioè gli import, `pinIcon` e `KeepSizeInSync`) con:

```tsx
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import { KeepSizeInSync, pinIcon } from "./map-shared";
```

Il resto del file (`export default function StoreMap…`) resta invariato: usa già `pinIcon` e `<KeepSizeInSync />`.

- [ ] **Step 6: Verificare che la scheda negozio non si sia rotta**

Run: `cd apps/customer && bun run typecheck`
Expected: nessun errore.

Run: `cd apps/customer && bun run build`
Expected: build completata. È il gate che cattura un import Leaflet finito nel bundle SSR.

Aprire `http://localhost:3001/stores` (dev server già avviato con `bun run dev` dalla root o da `apps/customer`), entrare in un negozio e controllare che la mappa nel rail si veda ancora, con il pin saffron.

- [ ] **Step 7: Commit**

```bash
git add package.json apps/customer/package.json bun.lock \
        apps/customer/src/features/stores/map-shared.ts \
        apps/customer/src/features/stores/store-map.tsx
git commit -m "$(cat <<'EOF'
chore(customer): aggiungi il clustering leaflet ed estrai i pezzi mappa

pinIcon e KeepSizeInSync vivranno in map-shared, usati sia dalla scheda
negozio sia dalla mappa dei risultati; react-leaflet-cluster porta i
cluster e @types/leaflet.markercluster i tipi che le sue d.ts pretendono.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Hook dei pin

**Files:**
- Create: `apps/customer/src/features/stores/use-store-map.ts`

**Interfaces:**
- Consumes: `api()` da `@/lib/api` (client Eden tipizzato sull'app API, quindi vede la route del Task 3); `Coords` da `@/features/discovery/use-geolocation`; `OpenStatusView` da `./open-status`; `toYMD` da `@bibs/ui/lib/date`
- Produces: `useStoreMap(args): { pins: StorePinView[]; total: number; mappable: number; truncated: boolean; isPending: boolean; isError: boolean; refetch: () => void }` e `interface StorePinView { id: string; name: string; lat: number; lng: number; category: { id: string; name: string } | null; city: string; province: string; distance: number | null; imageUrl: string | null; openStatus: OpenStatusView }`

- [ ] **Step 1: Scrivere l'hook**

Create `apps/customer/src/features/stores/use-store-map.ts`:

```ts
import { toYMD } from "@bibs/ui/lib/date";
import { useQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/discovery/use-geolocation";
import { api } from "@/lib/api";
import type { OpenStatusView } from "./open-status";

export interface StorePinView {
	id: string;
	name: string;
	lat: number;
	lng: number;
	category: { id: string; name: string } | null;
	city: string;
	province: string;
	/** metri, o null senza posizione utente */
	distance: number | null;
	imageUrl: string | null;
	openStatus: OpenStatusView;
}

interface UseStoreMapArgs {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	coords: Coords | null;
	radius?: number;
	openNow?: boolean;
	/** I pin si scaricano solo quando l'utente chiede la mappa. */
	enabled: boolean;
}

/**
 * I pin della vista mappa: gli stessi filtri della lista, in una richiesta
 * sola. `total` è il numero che la lista mostra; `mappable` quanti di quelli
 * hanno una posizione. La differenza va detta all'utente, non nascosta.
 */
export function useStoreMap({
	q,
	categoryId,
	macroCategoryId,
	coords,
	radius,
	openNow,
	enabled,
}: UseStoreMapArgs) {
	const query = useQuery({
		queryKey: [
			"store-map",
			q ?? "",
			categoryId ?? "",
			macroCategoryId ?? "",
			coords?.lat ?? null,
			coords?.lng ?? null,
			radius ?? null,
			openNow ?? false,
		],
		enabled,
		staleTime: 60_000,
		queryFn: async () => {
			const { data, error } = await api().customer.stores.map.get({
				query: {
					...(q ? { q } : {}),
					...(categoryId ? { categoryId } : {}),
					...(macroCategoryId ? { macroCategoryId } : {}),
					...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
					...(coords && radius ? { radius } : {}),
					...(openNow ? { openNow } : {}),
				},
			});
			if (error) {
				throw new Error(`Mappa negozi non disponibile (${error.status})`);
			}
			return data.data;
		},
	});

	const pins: StorePinView[] = (query.data?.pins ?? []).map((p) => ({
		id: p.id,
		name: p.name,
		lat: p.coordinates.lat,
		lng: p.coordinates.lng,
		category: p.category,
		city: p.municipality.name,
		province: p.municipality.provinceAcronym,
		distance: p.distance,
		imageUrl: p.image?.url ?? null,
		openStatus: {
			isOpen: p.openStatus.isOpen,
			status: p.openStatus.status,
			closesAt: p.openStatus.closesAt ?? undefined,
			// Eden idrata le stringhe-data in Date: senza toYMD il confronto con
			// "oggi" in describeOpensAt confronterebbe un Date con una stringa.
			opensAt: p.openStatus.opensAt
				? {
						date: toYMD(p.openStatus.opensAt.date),
						time: p.openStatus.opensAt.time,
					}
				: undefined,
		},
	}));

	return {
		pins,
		total: query.data?.total ?? 0,
		mappable: query.data?.mappable ?? 0,
		truncated: query.data?.truncated ?? false,
		isPending: query.isPending,
		isError: query.isError,
		refetch: query.refetch,
	};
}
```

- [ ] **Step 2: Verificare che Eden veda la route**

Run: `cd apps/customer && bun run typecheck`
Expected: nessun errore. Questo è il test vero di questo task: se `api().customer.stores.map` non esistesse nei tipi, o se `data.data` non avesse `pins`, il typecheck sarebbe rosso.

Se il typecheck si lamenta di tipi Eden incoerenti (path che non risolvono, `never` inattesi) **senza** che la route sia sbagliata, la causa abituale è una copia vecchia nello store `.bun`: lanciare `bun install` pulito dalla root e ripetere.

- [ ] **Step 3: Commit**

```bash
git add apps/customer/src/features/stores/use-store-map.ts
git commit -m "$(cat <<'EOF'
feat(customer): hook dei pin per la vista mappa

Una query sola, abilitata solo quando l'utente chiede la mappa, con le
stesse chiavi di filtro della ricerca.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: La mappa dei risultati

**Files:**
- Create: `apps/customer/src/features/stores/store-search-map.tsx`

**Interfaces:**
- Consumes: `StorePinView` (Task 5), `pinIcon`/`userLocationIcon`/`KeepSizeInSync` (Task 4), `formatDistance`/`TileImage` da `@/components/tile`, `openStatusLabel` da `./open-status`, `Coords` da `@/features/discovery/use-geolocation`
- Produces: default export `StoreSearchMap({ pins, showDistance, userCoords }: { pins: StorePinView[]; showDistance: boolean; userCoords: Coords | null })` — **default**, perché il Task 7 lo carica con `lazy()`

- [ ] **Step 1: Scrivere il componente**

Create `apps/customer/src/features/stores/store-search-map.tsx`:

```tsx
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { Link } from "@tanstack/react-router";
import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { formatDistance, TileImage } from "@/components/tile";
import type { Coords } from "@/features/discovery/use-geolocation";
import { KeepSizeInSync, pinIcon, userLocationIcon } from "./map-shared";
import { openStatusLabel } from "./open-status";
import type { StorePinView } from "./use-store-map";

/** Centro e zoom di partenza: l'Italia intera, finché `FitToPins` non corregge. */
const ITALY_CENTER: [number, number] = [41.9, 12.5];
const ITALY_ZOOM = 5;

/**
 * Bolla di un cluster. Stessa famiglia del pin (saffron su bordo Ink), in stile
 * inline: l'HTML di un divIcon lo inietta Leaflet nel documento, quindi le
 * variabili CSS risolvono senza dipendere dallo scanner di Tailwind.
 */
function clusterIcon(cluster: L.MarkerCluster) {
	const count = cluster.getChildCount();
	const size = count < 10 ? 36 : count < 100 ? 44 : 52;
	return L.divIcon({
		className: "",
		html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:var(--saffron);border:2px solid var(--ink);color:var(--ink);font-family:var(--font-mono);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;box-shadow:0 1px 4px rgb(0 0 0 / 0.25)">${count}</div>`,
		iconSize: L.point(size, size, true),
	});
}

/**
 * Inquadra i pin a ogni cambio dell'insieme. Il set cambia quando cambiano i
 * filtri, non a ogni render: la chiave lo riassume.
 */
function FitToPins({ pins }: { pins: StorePinView[] }) {
	const map = useMap();
	const key = pins.map((p) => p.id).join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` riassume `pins`
	useEffect(() => {
		if (pins.length === 0) return;
		if (pins.length === 1) {
			map.setView([pins[0].lat, pins[0].lng], 15);
			return;
		}
		map.fitBounds(
			L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])),
			{ padding: [48, 48] },
		);
	}, [key, map]);

	return null;
}

/** Mini-card del popup: gli stessi pezzi del tile, in formato orizzontale. */
function PinCard({
	pin,
	showDistance,
}: {
	pin: StorePinView;
	showDistance: boolean;
}) {
	const hasDistance = showDistance && pin.distance !== null;
	return (
		<Link
			to="/stores/$storeId"
			params={{ storeId: pin.id }}
			className="group flex w-56 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-saffron"
		>
			<div className="size-14 shrink-0 overflow-hidden rounded-md border border-border">
				<TileImage url={pin.imageUrl} name={pin.name} />
			</div>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="line-clamp-2 font-medium text-[0.875rem] text-foreground leading-snug group-hover:text-primary">
					{pin.name}
				</span>
				<span className="truncate text-muted-foreground text-xs">
					{pin.category ? `${pin.category.name} · ` : ""}
					{pin.city} ({pin.province})
				</span>
				<span
					className={`text-xs ${pin.openStatus.isOpen ? "text-primary" : "text-muted-foreground"}`}
				>
					{openStatusLabel(pin.openStatus)}
					{hasDistance && ` · ${formatDistance(pin.distance as number)}`}
				</span>
			</div>
		</Link>
	);
}

/**
 * I risultati della ricerca su mappa. Stessi negozi della lista: spostare la
 * mappa non rifà la ricerca, sono i filtri a decidere cosa si vede.
 */
export default function StoreSearchMap({
	pins,
	showDistance,
	userCoords,
}: {
	pins: StorePinView[];
	showDistance: boolean;
	userCoords: Coords | null;
}) {
	return (
		<MapContainer
			center={ITALY_CENTER}
			zoom={ITALY_ZOOM}
			scrollWheelZoom={false}
			className="h-full w-full"
			style={{ zIndex: 0 }}
		>
			<TileLayer
				attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
			/>
			<MarkerClusterGroup
				iconCreateFunction={clusterIcon}
				showCoverageOnHover={false}
				maxClusterRadius={60}
			>
				{pins.map((pin) => (
					<Marker
						key={pin.id}
						position={[pin.lat, pin.lng]}
						icon={pinIcon}
						title={pin.name}
					>
						<Popup>
							<PinCard pin={pin} showDistance={showDistance} />
						</Popup>
					</Marker>
				))}
			</MarkerClusterGroup>
			{userCoords && (
				<Marker
					position={[userCoords.lat, userCoords.lng]}
					icon={userLocationIcon}
					title="La tua posizione"
				/>
			)}
			<FitToPins pins={pins} />
			<KeepSizeInSync />
		</MapContainer>
	);
}
```

- [ ] **Step 2: Verificare tipi e lint**

Run: `cd apps/customer && bun run typecheck`
Expected: nessun errore. Se `L.MarkerCluster` risulta sconosciuto, manca `@types/leaflet.markercluster` (Task 4, Step 1-3).

Run: `bunx biome check apps/customer/src/features/stores/store-search-map.tsx`
Expected: nessun errore.

Il componente non è ancora montato da nessuno: la verifica visiva arriva nel Task 7.

- [ ] **Step 3: Commit**

```bash
git add apps/customer/src/features/stores/store-search-map.tsx
git commit -m "$(cat <<'EOF'
feat(customer): componente mappa dei risultati con cluster e popup

Pin raggruppati, bolla del cluster nei token del brand, popup che riusa
i pezzi del tile e linka alla scheda; l'inquadratura segue i risultati.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Toggle Lista/Mappa e montaggio nella pagina

**Files:**
- Create: `apps/customer/src/features/stores/store-view-toggle.tsx`
- Modify: `apps/customer/src/routes/_authenticated/stores/index.tsx`
- Modify: `apps/customer/messages/it.json`
- Modify: `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `StoreSearchMap` (Task 6, default export), `useStoreMap()` (Task 5), `ToggleGroup`/`ToggleGroupItem` da `@bibs/ui/components/toggle-group`
- Produces: `StoreView = "list" | "map"` e `StoreViewToggle({ value, onChange }: { value: StoreView; onChange: (v: StoreView) => void })` da `./store-view-toggle`

- [ ] **Step 1: Aggiungere le stringhe**

In `apps/customer/messages/it.json`, accanto alle altre `store_*` (dopo `"store_search_clear"`):

```json
	"store_view_list": "Lista",
	"store_view_map": "Mappa",
	"store_view_label": "Modo di visualizzare i risultati",
	"store_map_truncated": "Mostrati i primi {count} negozi — restringi la ricerca",
	"store_map_unmapped": "{count} negozi non hanno una posizione sulla mappa",
	"store_map_unmapped_one": "1 negozio non ha una posizione sulla mappa",
	"store_map_error_title": "Mappa non disponibile",
	"store_map_error_description": "Non siamo riusciti a caricare i negozi sulla mappa. Riprova.",
```

In `apps/customer/messages/en.json`, le stesse chiavi:

```json
	"store_view_list": "List",
	"store_view_map": "Map",
	"store_view_label": "Result display mode",
	"store_map_truncated": "Showing the first {count} shops — narrow your search",
	"store_map_unmapped": "{count} shops have no position on the map",
	"store_map_unmapped_one": "1 shop has no position on the map",
	"store_map_error_title": "Map unavailable",
	"store_map_error_description": "We couldn't load the shops on the map. Try again.",
```

Run: `cd apps/customer && bun run paraglide:compile`
Expected: compilazione senza errori. Se una chiave esiste in un solo file, qui si vede.

- [ ] **Step 2: Scrivere il toggle**

Create `apps/customer/src/features/stores/store-view-toggle.tsx`:

```tsx
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@bibs/ui/components/toggle-group";
import { LayoutGrid, Map } from "lucide-react";
import { m } from "@/paraglide/messages";

export type StoreView = "list" | "map";

/**
 * Selettore della vista. `type="single"` espone il ruolo radio, quindi la vista
 * attiva è annunciata senza aria-* aggiunti a mano. Lo stato "on" di default è
 * un `bg-muted` da hover: qui la scelta è binaria e va letta a colpo d'occhio,
 * quindi la vista attiva prende la superficie piena.
 */
export function StoreViewToggle({
	value,
	onChange,
}: {
	value: StoreView;
	onChange: (value: StoreView) => void;
}) {
	return (
		<ToggleGroup
			type="single"
			size="sm"
			variant="outline"
			value={value}
			// Radix emette "" quando si ri-clicca la voce attiva: una vista deve
			// sempre esserci, quindi si ignora.
			onValueChange={(next) => next && onChange(next as StoreView)}
			aria-label={m.store_view_label()}
		>
			<ToggleGroupItem
				value="list"
				className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
			>
				<LayoutGrid className="size-4" aria-hidden />
				{m.store_view_list()}
			</ToggleGroupItem>
			<ToggleGroupItem
				value="map"
				className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
			>
				<Map className="size-4" aria-hidden />
				{m.store_view_map()}
			</ToggleGroupItem>
		</ToggleGroup>
	);
}
```

- [ ] **Step 3: Aggiungere il search param `view`**

In `apps/customer/src/routes/_authenticated/stores/index.tsx`:

Nell'interfaccia `StoreSearchParams`, dopo `openNow?: boolean;`:

```ts
	/** Assente = lista: `/stores` nudo resta la vista di sempre. */
	view?: "map";
```

In `validateSearch`, dopo la riga di `openNow`:

```ts
	view: search.view === "map" ? "map" : undefined,
```

Nella destrutturazione di `Route.useSearch()`, aggiungere `view`:

```ts
	const { q, categoryId, macroCategoryId, radius, openNow, view } =
		Route.useSearch();
```

- [ ] **Step 4: Montare la mappa client-only e cablare il toggle**

Sempre in `index.tsx`.

Import da aggiungere in testa (accanto agli altri):

```tsx
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import type { StoreView } from "@/features/stores/store-view-toggle";
import { StoreViewToggle } from "@/features/stores/store-view-toggle";
import { useStoreMap } from "@/features/stores/use-store-map";
```

`useEffect`, `useRef` e `useState` sono già importati da `react`: estendere quell'import invece di duplicarlo. Idem per `lucide-react`, dove `Map` va importato come `MapIcon` per non collidere con il `Map` globale.

Sotto le costanti di layout, aggiungere:

```tsx
/**
 * Su desktop la mappa riempie la finestra sotto la riga dei risultati, così non
 * si scrolla la pagina per vederne il fondo; su mobile resta una superficie
 * alta ma finita.
 */
const MAP_FRAME = "h-[26rem] min-h-80 sm:h-[32rem] lg:h-[calc(100dvh-16rem)]";

const LazyStoreSearchMap = lazy(
	() => import("@/features/stores/store-search-map"),
);
```

Dentro `StoresPage`, dopo la chiamata a `useStoreSearch`:

```tsx
	const isMap = view === "map";

	const map = useStoreMap({
		q,
		categoryId,
		macroCategoryId,
		coords,
		radius,
		openNow,
		enabled: isMap,
	});

	// Leaflet è DOM-only: la mappa monta solo dopo l'hydration, mai in SSR.
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);

	// Niente `replace: true` qui (a differenza del testo di ricerca, che è
	// debounced): tornare indietro dalla mappa alla lista è un'aspettativa
	// legittima, e `navigate` senza `replace` lascia la voce nella cronologia.
	const changeView = (next: StoreView) => {
		void navigate({
			search: (prev) => ({ ...prev, view: next === "map" ? "map" : undefined }),
		});
	};
```

Nella riga dei risultati, subito **dopo** il blocco `{activeFilterCount > 0 && (<button …>…</button>)}`, aggiungere il toggle come ultimo figlio del contenitore flex:

```tsx
						<StoreViewToggle
							value={isMap ? "map" : "list"}
							onChange={changeView}
						/>
```

Il contenitore ha già `justify-between` e `flex-wrap`: il toggle si sistema a destra e va a capo sugli schermi stretti. Per tenere il bottone "Azzera filtri" accanto al toggle invece che all'estremità opposta, avvolgere quel bottone e il toggle in un `<div className="flex items-center gap-3">`.

Infine, il corpo dei risultati. La catena di ternari dentro `<div className="mt-4">` è già profonda: invece di annidarci dentro un altro ramo, si estraggono le due viste in due costanti prima del `return`, e il blocco si riduce a una scelta.

**4a.** Spostare l'espressione che oggi sta dentro `<div className="mt-4">…</div>` — l'intera catena `isPending ? (…) : isError ? (…) : stores.length === 0 ? (…) : (…)`, **verbatim, senza cambiarne una riga** — in una costante dichiarata subito prima del `return` di `StoresPage`:

```tsx
	const listResults = (
		/* qui la catena esistente, invariata */
	);
```

**4b.** Dichiarare accanto la vista mappa:

```tsx
	const mapResults = map.isError ? (
		<Notice
			icon={RotateCw}
			title={m.store_map_error_title()}
			description={m.store_map_error_description()}
			action={
				<Button variant="secondary" size="sm" onClick={() => map.refetch()}>
					<RotateCw className="size-4" aria-hidden />
					{m.store_retry()}
				</Button>
			}
		/>
	) : !map.isPending && map.pins.length === 0 ? (
		<Notice
			icon={MapIcon}
			title={hasQuery ? m.store_no_results_title() : m.store_explore_title()}
			description={
				hasQuery
					? m.store_no_results_description()
					: m.store_explore_description()
			}
			action={
				activeFilterCount > 0 ? (
					<Button variant="secondary" size="sm" onClick={clearFilters}>
						{m.store_clear_filters()}
					</Button>
				) : undefined
			}
		/>
	) : (
		<div className="space-y-2">
			{map.truncated && (
				<p className="text-muted-foreground text-sm">
					{m.store_map_truncated({ count: map.pins.length })}
				</p>
			)}
			{map.total > map.mappable && (
				<p className="text-muted-foreground text-sm">
					{map.total - map.mappable === 1
						? m.store_map_unmapped_one()
						: m.store_map_unmapped({ count: map.total - map.mappable })}
				</p>
			)}
			<div
				className={`relative isolate overflow-hidden rounded-lg border border-border ${MAP_FRAME}`}
			>
				{hydrated && !map.isPending ? (
					<Suspense fallback={<div className="size-full bg-muted" />}>
						<LazyStoreSearchMap
							pins={map.pins}
							showDistance={geoStatus === "granted"}
							userCoords={coords}
						/>
					</Suspense>
				) : (
					<div className="size-full animate-pulse bg-muted" aria-hidden />
				)}
			</div>
		</div>
	);
```

**4c.** Ridurre il blocco dei risultati a una riga sola:

```tsx
					<div className="mt-4">{isMap ? mapResults : listResults}</div>
```

Le due costanti sono espressioni JSX, non componenti: nessun hook al loro interno, quindi non cambiano nulla per le regole degli hook né per React Compiler.

- [ ] **Step 5: Verificare che compili e che l'SSR regga**

Run: `cd apps/customer && bun run typecheck`
Expected: nessun errore.

Run: `cd apps/customer && bun run build`
Expected: build completata. Un `window is not defined` qui significa che un import Leaflet è sfuggito al `lazy()`.

Run: `bunx biome check apps/customer/src`
Expected: nessun errore.

- [ ] **Step 6: Guardare la pagina**

Con i dev server attivi (`api` su 3000, `customer` su 3001) e l'utente customer di sviluppo, aprire `http://localhost:3001/stores` e verificare:

1. Il toggle è nella riga dei risultati; "Lista" è attivo e la griglia è quella di prima.
2. Cliccando "Mappa": l'URL diventa `/stores?view=map`, compare la mappa, i pin sono raggruppati.
3. Zoomando su un cluster i pin si separano; cliccando un pin si apre la mini-card; cliccandola si arriva alla scheda negozio.
4. Tornando indietro col browser si torna alla lista.
5. Selezionando una macro categoria nel rail **mentre si è in mappa**, i pin cambiano e l'inquadratura si riadatta.
6. Con "Aperti ora" attivo, i pin si riducono.
7. Ricaricando `/stores?view=map` la pagina apre già in mappa e non lancia errori in console.

- [ ] **Step 7: Commit**

```bash
git add apps/customer/src/features/stores/store-view-toggle.tsx \
        apps/customer/src/routes/_authenticated/stores/index.tsx \
        apps/customer/messages/it.json apps/customer/messages/en.json
git commit -m "$(cat <<'EOF'
feat(customer): vista mappa nella ricerca negozi

Toggle Lista/Mappa nella riga dei risultati, con la vista nell'URL
(?view=map) e la mappa al posto della griglia. I filtri restano gli
stessi: la mappa e' un'altra lettura della stessa ricerca.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verifica finale e chiusura

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-customer-store-map-view-design.md` (riga 4, `**Status:**`)

- [ ] **Step 1: Suite completa dell'API**

Run: `cd apps/api && bun test`
Expected: PASS su tutti i file. Se `isolation-guard-1`/`isolation-guard-2` falliscono, manca `--isolate` nello script: non modificare i guard.

- [ ] **Step 2: Typecheck di tutti i workspace toccati**

Run: `cd apps/api && bun run typecheck && echo "api ok"`
Run: `cd apps/customer && bun run typecheck && echo "customer ok"`
Run: `cd apps/seller && bun run typecheck && echo "seller ok"`
Run: `cd apps/admin && bun run typecheck && echo "admin ok"`
Expected: le quattro righe `ok`. Seller e admin contano perché condividono i tipi Eden dell'app API: una modifica allo schema può romperli anche se non li abbiamo toccati.

- [ ] **Step 3: Lint e build**

Run: `bunx biome check apps/api/src apps/customer/src`
Expected: nessun errore.

Run: `cd apps/customer && bun run build`
Expected: build completata.

- [ ] **Step 4: Smoke in dark mode e a larghezza telefono**

Nel browser, su `/stores?view=map`:

```js
localStorage.theme = 'dark'; location.reload();
```

Verificare che il pin saffron e la bolla del cluster restino leggibili, che la mini-card del popup non abbia testo invisibile (superfici theme-aware, accenti fissi solo sopra la foto) e che i controlli di zoom si vedano.

Poi ridurre la finestra a ~390px di larghezza e controllare che il toggle resti raggiungibile, che la mappa non superi la larghezza della pagina e che la pagina non scrolli orizzontalmente.

- [ ] **Step 5: Controllare che nulla di generato sia rimasto fuori**

Run: `git status --porcelain`
Expected: pulito. In particolare `apps/customer/src/routeTree.gen.ts` non dovrebbe essere cambiato (abbiamo aggiunto un search param, non una route); se invece risulta modificato, va committato — è un file generato ma tracciato, e la CI typecheck fallisce se resta indietro.

- [ ] **Step 6: Aggiornare lo stato della spec e committare**

In `docs/superpowers/specs/2026-09-15-customer-store-map-view-design.md`, riga 4:

```markdown
**Status:** implemented
```

```bash
git add docs/superpowers/specs/2026-09-15-customer-store-map-view-design.md
git commit -m "$(cat <<'EOF'
docs(customer): segna implementata la spec della vista mappa

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Aprire la PR**

Usare `/commit-commands:commit-push-pr` oppure:

```bash
git push -u origin feat/customer-store-map-view
gh pr create --title "feat(customer): vista mappa nella ricerca negozi" --body "$(cat <<'EOF'
## Cosa

`/stores` guadagna un secondo modo di leggere la stessa ricerca: i negozi su
mappa, con i pin raggruppati in cluster, accanto alla griglia di card.

- `GET /customer/stores/map` — stessa query dei filtri, senza paginazione,
  tetto a 500 pin. `total` / `mappable` / `pins.length` sono tre numeri
  distinti e la UI dichiara le differenze.
- Le condizioni SQL dei filtri vivono ora in un helper condiviso da ricerca,
  facet e mappa.
- Toggle Lista/Mappa con la vista nell'URL (`?view=map`), mappa client-only.

Spec: `docs/superpowers/specs/2026-09-15-customer-store-map-view-design.md`

## Verifica

- `bun test` (api) verde, inclusi 6 test nuovi su `getStoreMapPins`
- typecheck su api + customer + seller + admin
- `bun run build` del customer (gate SSR per Leaflet)
- smoke browser: lista↔mappa, cluster, popup, filtri da dentro la mappa,
  deep link, dark mode, larghezza telefono

## Fuori scope

Ricerca per riquadro ("cerca in quest'area"), mappa nella home, hover
card↔pin. Il debito sui tap target dei controlli Leaflet (30px) resta quello
già annotato sulla scheda negozio.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Note per chi esegue

**Se `react-leaflet-cluster` non regge.** È l'unica dipendenza nuova a rischio (manutentore singolo, `main` CJS con dentro ESM). I sintomi sarebbero al Task 6: errore di import a runtime, o build del customer rotta. Il ripiego è non usarla e pilotare `leaflet.markercluster` a mano, sostituendo `<MarkerClusterGroup>` con un componente locale:

```tsx
import "leaflet.markercluster";

function ClusterLayer({
	pins,
	showDistance,
}: {
	pins: StorePinView[];
	showDistance: boolean;
}) {
	const map = useMap();
	useEffect(() => {
		const group = L.markerClusterGroup({
			iconCreateFunction: clusterIcon,
			showCoverageOnHover: false,
			maxClusterRadius: 60,
		});
		for (const pin of pins) {
			const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon, title: pin.name });
			marker.bindPopup(renderToStaticMarkup(<PinCard pin={pin} showDistance={showDistance} />));
			group.addLayer(marker);
		}
		map.addLayer(group);
		return () => {
			map.removeLayer(group);
		};
	}, [map, pins, showDistance]);
	return null;
}
```

Attenzione: con `renderToStaticMarkup` il popup è HTML statico, quindi il `Link` di TanStack Router diventa un `<a href>` — va costruito a mano (`href={"/stores/" + pin.id}`) e perde la navigazione client-side. Se si arriva qui, va segnalato invece di lasciarlo passare in silenzio.

**Se il typecheck del customer non vede `api().customer.stores.map`.** Prima si controlla che la route del Task 3 sia registrata nel modulo customer (lo è già via `storesRoutes`); poi si fa un `bun install` pulito dalla root, perché una copia vecchia di `elysia` nello store `.bun` fa collassare i tipi Eden. Solo dopo, come ultima risorsa, si rinomina l'endpoint in `/stores/pins`.
