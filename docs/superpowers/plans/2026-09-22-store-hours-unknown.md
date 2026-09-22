# Stato «orari non dichiarati» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un negozio che non ha mai dichiarato gli orari smette di essere mostrato come «Chiuso» — in tutte e quattro le superfici dove oggi lo è — e il seller viene sollecitato a compilarli.

**Architecture:** Il dominio guadagna un quarto stato, `status: "unknown"`, deciso in `getOpenStatus()` prima di ogni altra valutazione. Il nuovo valore risale il contratto Elysia fino ai client Eden dei tre frontend, che lo rendono con un'icona diversa a parità di tono. La gemella SQL `openNowCondition()` **non si tocca**: il nuovo stato può comparire solo su negozi che il filtro già escludeva, quindi la parità resta dimostrata.

**Tech Stack:** Bun · Elysia + TypeBox · Drizzle · TanStack Start/Router/Query · Eden Treaty · Tailwind v4 · paraglide (solo customer) · `bun:test`

**Spec:** [`docs/superpowers/specs/2026-09-22-store-hours-unknown-design.md`](../specs/2026-09-22-store-hours-unknown-design.md)

## Global Constraints

- **Testo utente customer, esatto:** «Orari non indicati» (griglia, copertina, popup mappa). Deciso; non parafrasare.
- **Tono invariato.** L'icona distingue ignoto da chiuso, **mai** l'opacità: `text-muted-foreground/70` misura 3,05 (light) e 3,49 (dark) contro la soglia AA di 4,5. Usare `text-muted-foreground` e `text-ink/60` come lo stato «Chiuso» attuale.
- **Icona:** `HelpCircle` da `lucide-react` quando `status === "unknown"`, `Clock` altrimenti.
- **`openNowCondition()` (`apps/api/src/lib/store-open-status.ts:119`) non va modificata.** Nessun `unknownTotal`, nessuna riga nei facet (decisione 3 della spec).
- **`isOpen` resta `false` per `unknown`.** Significa «non possiamo affermare che è aperto».
- **Nessuna migrazione DB.** `openingHours` è già nullable.
- **PR-first:** si lavora su `feat/store-hours-unknown-state`, già creato. Mai commit su `main`.
- **Commit:** Conventional Commits, scope whitelist del repo. Ogni commit chiude con:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Struttura dei file

| File | Responsabilità | Task |
|---|---|---|
| `apps/api/src/lib/holidays/types.ts` | l'union `OpenStatus.status` | 1 |
| `apps/api/src/lib/holidays/open-status.ts` | decide `unknown` prima di tutto | 1 |
| `apps/api/src/lib/schemas/holidays.ts` | espone il literal nel contratto | 1 |
| `apps/api/src/modules/customer/services/{store-discovery,store-map,store-detail}.ts` | i default `??` smettono di dire `closed` | 1 |
| `apps/customer/src/features/stores/open-status.ts` | union FE + etichetta | 1 |
| `apps/customer/src/features/stores/use-store-search.ts` | smette di duplicare l'union inline | 1 |
| `apps/customer/src/features/stores/{store-tile,store-cover}.tsx` | l'icona distingue | 2 |
| `apps/customer/src/features/stores/format-opening-hours.ts` | predicato puro `hasDeclaredHours` | 3 |
| `apps/customer/src/features/stores/opening-hours.tsx` | non rende 7 righe «Chiuso» | 3 |
| `apps/customer/messages/{it,en}.json` | `store_hours_unknown` | 3 |
| `apps/seller/src/routes/_authenticated/index.tsx` | avviso riparato | 4 |
| `apps/seller/src/features/stores/components/store-form.tsx` | sollecito nel profilo | 4 |
| `apps/customer/src/routes/preview-open-status.tsx` | **da cancellare** | 5 |

**Perché il Task 1 attraversa API e frontend.** Aggiungere un literal all'union senza allineare `OpenStatusView` lascia `use-store-search.ts` rosso al typecheck (Eden propaga 4 literal in un campo che ne accetta 3). Il commit più piccolo che lascia *tutti* i workspace verdi copre entrambi i lati: non è accorpamento arbitrario, è il taglio minimo.

---

### Task 1: Il dominio e il contratto distinguono «non lo so»

**Files:**
- Modify: `apps/api/src/lib/holidays/types.ts:24-31`
- Modify: `apps/api/src/lib/holidays/open-status.ts:39-48`
- Modify: `apps/api/src/lib/schemas/holidays.ts:94-99`
- Modify: `apps/api/src/modules/customer/services/store-discovery.ts:148`
- Modify: `apps/api/src/modules/customer/services/store-map.ts:160`
- Modify: `apps/api/src/modules/customer/services/store-detail.ts:112`
- Modify: `apps/customer/src/features/stores/open-status.ts:1-41`
- Modify: `apps/customer/src/features/stores/use-store-search.ts:1-21`
- Test: `apps/api/tests/lib/holidays/open-status.test.ts` (append)
- Test: `apps/api/tests/integration/customer-store-discovery.test.ts:447-456` (modify)
- Test: `apps/customer/src/features/stores/open-status.test.ts` (create)

**Interfaces:**
- Produces: `OpenStatus.status` e `OpenStatusView.status` = `"open" | "closed" | "closed_holiday" | "unknown"`; `openStatusLabel(status)` restituisce `"Orari non indicati"` quando `status.status === "unknown"`; `StoreCardView.openStatus` è ora esattamente `OpenStatusView` (importato, non più duplicato inline).

- [ ] **Step 1: Scrivi i test falliti del dominio**

Appendi a `apps/api/tests/lib/holidays/open-status.test.ts`. Il file ha già in testa `hours` (Lun-Ven 09:00-13:00 / 14:30-19:00) e `romeSummer(h, m)`; aggiungi l'import di `addDaysYMD`.

```ts
// in cima al file, accanto agli import esistenti:
import { addDaysYMD } from "@/lib/holidays";

describe("getOpenStatus — orari mai dichiarati", () => {
	it("returns unknown when openingHours is null", () => {
		const s = getOpenStatus({
			openingHours: null,
			closedDates: new Set(),
			now: romeSummer(10),
		});
		expect(s.status).toBe("unknown");
		expect(s.isOpen).toBe(false);
		expect(s.opensAt).toBeUndefined();
	});

	it("returns unknown for an empty array", () => {
		const s = getOpenStatus({
			openingHours: [],
			closedDates: new Set(),
			now: romeSummer(10),
		});
		expect(s.status).toBe("unknown");
	});

	it("returns unknown when every declared day has zero slots", () => {
		const s = getOpenStatus({
			openingHours: [
				{ dayOfWeek: 0, slots: [] },
				{ dayOfWeek: 1, slots: [] },
			],
			closedDates: new Set(),
			now: romeSummer(10),
		});
		expect(s.status).toBe("unknown");
	});

	it("unknown wins over closed_holiday: with no hours there is nothing to close", () => {
		const s = getOpenStatus({
			openingHours: null,
			closedDates: new Set(["2026-05-25"]),
			now: romeSummer(10),
		});
		expect(s.status).toBe("unknown");
	});

	// Questo test è il motivo per cui `unknown` sta nel dominio e non nel
	// frontend: un negozio CON orari, in ferie oltre i 60 giorni di lookahead,
	// esce senza `opensAt` esattamente come uno senza orari. Dedurre "non lo so"
	// dall'assenza di `opensAt` lo etichetterebbe male.
	it("a store WITH hours on a closure longer than the lookahead stays closed", () => {
		const closed = new Set<string>();
		for (let i = 1; i <= 70; i++) closed.add(addDaysYMD("2026-05-25", i));
		const s = getOpenStatus({
			openingHours: hours,
			closedDates: closed,
			now: romeSummer(20), // dopo la chiusura delle 19:00
		});
		expect(s.status).toBe("closed");
		expect(s.opensAt).toBeUndefined();
	});
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd apps/api && bun test tests/lib/holidays/open-status.test.ts`
Expected: FAIL — i primi quattro con `expect "closed" to be "unknown"` (o `"closed_holiday"` per il quarto). Il quinto **deve già passare**: descrive il comportamento attuale corretto ed è lì come rete anti-regressione.

- [ ] **Step 3: Allarga l'union nel dominio**

In `apps/api/src/lib/holidays/types.ts`, sostituisci il campo `status` di `OpenStatus`:

```ts
export interface OpenStatus {
	isOpen: boolean;
	/**
	 * `unknown` = il negozio non ha mai dichiarato gli orari. Non è una
	 * chiusura: è l'assenza del dato. Tenerlo distinto da `closed` è il punto
	 * di tutto — "Chiuso" è un'affermazione che in quel caso non possiamo
	 * sostenere.
	 */
	status: "open" | "closed" | "closed_holiday" | "unknown";
	/** "HH:mm" the store closes today, when currently open. */
	closesAt?: string;
	/** Next opening when currently closed. */
	opensAt?: { date: string; time: string };
}
```

- [ ] **Step 4: Decidi `unknown` prima di ogni altra valutazione**

In `apps/api/src/lib/holidays/open-status.ts`, inserisci il ramo subito dopo la destrutturazione di `input` e **prima** di `nowInRome`:

```ts
export function getOpenStatus(input: {
	openingHours: OpeningHoursDay[] | null;
	closedDates: Set<string>;
	now: Date;
}): OpenStatus {
	const { openingHours, closedDates } = input;

	// "Non lo so" precede tutto: senza una fascia dichiarata non c'è nulla su
	// cui decidere aperto o chiuso, nemmeno se oggi è festivo. `[]` e
	// `slots: []` valgono quanto `null` — il predicato non si appoggia al
	// `minItems: 1` della route del seller, perché il dato può arrivare da
	// seed o migrazioni.
	if (!openingHours?.some((d) => d.slots.length > 0)) {
		return { isOpen: false, status: "unknown" };
	}

	const { date: today, minutes } = nowInRome(input.now);
	const closedToday = closedDates.has(today);

	// ...il resto della funzione resta identico
```

- [ ] **Step 5: Esegui i test del dominio e verifica che passino**

Run: `cd apps/api && bun test tests/lib/holidays/open-status.test.ts`
Expected: PASS, tutti — inclusi i test preesistenti su aperto/chiuso/festività.

- [ ] **Step 6: Esponi il literal nel contratto**

In `apps/api/src/lib/schemas/holidays.ts`, in `OpenStatusSchema`:

```ts
export const OpenStatusSchema = t.Object({
	isOpen: t.Boolean(),
	status: t.Union([
		t.Literal("open"),
		t.Literal("closed"),
		t.Literal("closed_holiday"),
		t.Literal("unknown"),
	]),
	closesAt: t.Optional(
		t.String({ description: "Orario chiusura odierno (HH:mm)" }),
	),
	opensAt: t.Optional(t.Object({ date: t.String(), time: t.String() })),
});
```

Le quattro incastonature (`entities.ts:726`, `entities.ts:747`, `entities.ts:814`, `composed.ts:35`) ereditano da sole: **non modificarle**.

- [ ] **Step 7: I default dei service smettono di fabbricare «closed»**

Tre file, una riga ciascuno. Sono rami morti (`resolveOpenStatuses` restituisce una voce per riga) ma scrivono la bugia che stiamo togliendo; il loro significato reale è «non abbiamo lo stato».

In `apps/api/src/modules/customer/services/store-discovery.ts:148`, `store-map.ts:160` e `store-detail.ts:112`, sostituisci in ognuno:

```ts
openStatus: statusMap.get(r.id) ?? { isOpen: false, status: "closed" },
```

con:

```ts
openStatus: statusMap.get(r.id) ?? { isOpen: false, status: "unknown" },
```

In `store-detail.ts` la variabile è `row` e non `r`: usa `statusMap.get(row.id)`. Lascia intatto il commento esistente sopra la riga in `store-discovery.ts`.

- [ ] **Step 8: Correggi il test d'integrazione che codificava il bug**

In `apps/api/tests/integration/customer-store-discovery.test.ts`, il test alle righe 447-456 asserisce `status === "closed"` per un negozio senza orari: **codifica il comportamento sbagliato**, quindi va aggiornato. Non è un indebolimento — l'asserzione diventa più specifica, non più lasca. Sostituisci quel blocco `it` con:

```ts
	it("reports unknown when openingHours is unset", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "SenzaOrari" });

		const result = await searchStores({});
		expect(result.data[0].openStatus.isOpen).toBe(false);
		// Non "closed": non sappiamo se è chiuso, sappiamo che non ce l'ha detto.
		expect(result.data[0].openStatus.status).toBe("unknown");
	});

	it("keeps a store without hours out of the openNow filter", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "SenzaOrari" });

		const filtered = await searchStores({ openNow: true, limit: 100 });
		expect(filtered.data.map((s) => s.name)).not.toContain("SenzaOrari");
	});
```

- [ ] **Step 9: Esegui il test di parità per intero**

Questo file è il solo posto che tiene allineate `getOpenStatus` e `openNowCondition`. Va eseguito **tutto**, non solo i test nuovi.

Run: `cd apps/api && bun test tests/integration/customer-store-discovery.test.ts`
Expected: PASS. In particolare deve restare verde il test «La condizione SQL e `getOpenStatus` sono due implementazioni della stessa regola» (~riga 663): dimostra che nessun negozio ha cambiato lato del filtro.

Se fallisce lì, **fermati e riporta**: significa che il ramo `unknown` ha intercettato un negozio che il SQL includeva, e la premessa della spec è sbagliata.

- [ ] **Step 10: Scrivi il test fallito dell'etichetta customer**

Crea `apps/customer/src/features/stores/open-status.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { openStatusLabel } from "./open-status";

describe("openStatusLabel", () => {
	it("says the hours are missing, never «Chiuso», when the status is unknown", () => {
		expect(openStatusLabel({ isOpen: false, status: "unknown" })).toBe(
			"Orari non indicati",
		);
	});

	it("still says «Chiuso» for a store we know is closed", () => {
		expect(openStatusLabel({ isOpen: false, status: "closed" })).toBe("Chiuso");
	});

	it("keeps the reopening detail when we have one", () => {
		const label = openStatusLabel({
			isOpen: false,
			status: "closed",
			opensAt: { date: "2999-01-01", time: "08:30" },
		});
		expect(label).toStartWith("Chiuso · apre ");
		expect(label).toContain("08:30");
	});

	it("is unaffected for an open store", () => {
		expect(
			openStatusLabel({ isOpen: true, status: "open", closesAt: "19:30" }),
		).toBe("Aperto · chiude alle 19:30");
	});
});
```

- [ ] **Step 11: Esegui il test e verifica che fallisca**

Run: `cd apps/customer && bun test src/features/stores/open-status.test.ts`
Expected: FAIL sul primo caso con `expect "Chiuso" to be "Orari non indicati"`.

Nota: `bun test` esegue TypeScript senza typecheck, quindi `status: "unknown"` **non** produce un errore di tipo qui, anche se l'union FE non lo conosce ancora — il rosso arriva dall'asserzione. Il typecheck vero è lo step 15.

- [ ] **Step 12: Allinea l'union FE e aggiungi il ramo nell'etichetta**

In `apps/customer/src/features/stores/open-status.ts`:

```ts
export interface OpenStatusView {
	isOpen: boolean;
	status: "open" | "closed" | "closed_holiday" | "unknown";
	closesAt?: string;
	opensAt?: { date: string; time: string };
}
```

e, in `openStatusLabel`, il ramo va **per primo** (perché `unknown` porta `isOpen: false` e cadrebbe nel ramo «Chiuso»):

```ts
/** "Aperto · chiude alle 19:30" / "Chiuso · apre …" / "Orari non indicati". */
export function openStatusLabel(status: OpenStatusView): string {
	// Senza orari dichiarati non possiamo dire né aperto né chiuso. Prima di
	// `isOpen`, che per questo stato è `false` e porterebbe a "Chiuso".
	if (status.status === "unknown") return "Orari non indicati";
	if (status.isOpen) {
		return status.closesAt
			? `Aperto · chiude alle ${status.closesAt}`
			: "Aperto";
	}
	if (status.opensAt) return `Chiuso · ${describeOpensAt(status.opensAt)}`;
	return "Chiuso";
}
```

- [ ] **Step 13: Elimina l'union duplicata in `use-store-search.ts`**

`StoreCardView` ridichiara inline la stessa union invece di riusare `OpenStatusView` (come già fanno `use-store-detail.ts` e `use-store-map.ts`). Riusala, così resta un posto solo da allargare.

In `apps/customer/src/features/stores/use-store-search.ts`, aggiungi l'import e sostituisci il campo:

```ts
import type { OpenStatusView } from "./open-status";

export interface StoreCardView {
	id: string;
	name: string;
	category: { id: string; name: string } | null;
	city: string;
	province: string;
	addressLine1: string;
	/** meters, or null when no geo / store has no location */
	distance: number | null;
	imageUrl: string | null;
	openStatus: OpenStatusView;
}
```

Il mapper alle righe ~98-107 **non cambia**: copia già i campi uno a uno.

- [ ] **Step 14: Esegui i test customer e verifica che passino**

Run: `cd apps/customer && bun test src/features/stores/open-status.test.ts`
Expected: PASS, tutti e quattro.

- [ ] **Step 15: Typecheck di ogni workspace, uno per uno**

`bun run --filter '*'` aggrega e può nascondere il fallimento di un singolo workspace: vanno lanciati separatamente controllando l'exit code.

```bash
cd /Users/marcogelli/repos/jelaz/bibs
for w in @bibs/api @bibs/customer @bibs/seller @bibs/admin; do
  bun run --filter "$w" typecheck; echo "$w -> exit $?";
done
```
Expected: `exit 0` per tutti e quattro.

- [ ] **Step 16: Commit**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
git add apps/api/src/lib/holidays/types.ts \
        apps/api/src/lib/holidays/open-status.ts \
        apps/api/src/lib/schemas/holidays.ts \
        apps/api/src/modules/customer/services/store-discovery.ts \
        apps/api/src/modules/customer/services/store-map.ts \
        apps/api/src/modules/customer/services/store-detail.ts \
        apps/api/tests/lib/holidays/open-status.test.ts \
        apps/api/tests/integration/customer-store-discovery.test.ts \
        apps/customer/src/features/stores/open-status.ts \
        apps/customer/src/features/stores/open-status.test.ts \
        apps/customer/src/features/stores/use-store-search.ts
git commit -F - <<'EOF'
feat(api): stato "unknown" per i negozi senza orari dichiarati

getOpenStatus faceva collassare "non ha orari" e "e' chiuso" sullo stesso
status: da li' in poi nessun consumatore poteva piu' distinguerli, e il
customer mostrava "Chiuso" per 23 degli 86 negozi del seed.

Il ramo precede ogni altra valutazione (anche le festivita'): senza una
fascia dichiarata non c'e' nulla su cui decidere. openNowCondition resta
invariata e la parita' regge, perche' il SQL include un negozio solo se
trova uno slot che copre adesso -- quindi il ramo unknown non lo raggiunge
mai. Il test d'integrazione che asseriva "closed" per un negozio senza
orari codificava il bug ed e' stato corretto.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: L'icona distingue l'ignoto dal chiuso

**Files:**
- Modify: `apps/customer/src/features/stores/store-tile.tsx:1-19`
- Modify: `apps/customer/src/features/stores/store-cover.tsx:1-86`

**Interfaces:**
- Consumes: `openStatusLabel` e `OpenStatusView` dal Task 1.
- Produces: nessuna nuova interfaccia — solo resa.

Non c'è test automatico: il customer non ha una libreria di test per componenti (solo test di logica pura). La verifica di questo task è **a schermo**, ed è vincolante.

`store-search-map.tsx` **non va toccato**: il popup della mappa non ha icona, quindi l'etichetta nuova arriva da sola da `openStatusLabel`, e il ramo `!isOpen` applica già `text-muted-foreground`.

- [ ] **Step 1: Sostituisci l'icona nella tile della griglia**

In `apps/customer/src/features/stores/store-tile.tsx`, cambia l'import e `OpenStatusLine`:

```tsx
import { Clock, HelpCircle, MapPin } from "lucide-react";
```

```tsx
/**
 * Riga di stato apertura. L'icona porta la distinzione: l'orologio è di chi un
 * orario ce l'ha, il punto interrogativo di chi non l'ha mai dichiarato. Il
 * tono resta lo stesso per entrambi — smorzarlo scenderebbe sotto il contrasto
 * AA (3,05 in light, 3,49 in dark, misurati).
 */
function OpenStatusLine({ status }: { status: StoreCardView["openStatus"] }) {
	const Icon = status.status === "unknown" ? HelpCircle : Clock;
	return (
		<span
			className={`inline-flex items-center gap-1 text-xs ${
				status.isOpen ? "text-primary" : "text-muted-foreground"
			}`}
		>
			<Icon className="size-3" aria-hidden />
			{openStatusLabel(status)}
		</span>
	);
}
```

- [ ] **Step 2: Sostituisci l'icona nel badge della copertina**

In `apps/customer/src/features/stores/store-cover.tsx`, cambia l'import:

```tsx
import { ChevronLeft, Clock, HelpCircle } from "lucide-react";
```

Nel corpo di `StoreCover`, accanto a `const initial = …`, aggiungi:

```tsx
	const StatusIcon = openStatus.status === "unknown" ? HelpCircle : Clock;
```

e nel badge (righe ~76-83) sostituisci `<Clock …/>` con `<StatusIcon …/>`, lasciando invariate classi e tono:

```tsx
				<span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 font-medium text-ink text-xs">
					<StatusIcon
						className={`size-3.5 ${
							openStatus.isOpen ? "text-saffron-deep" : "text-ink/60"
						}`}
						aria-hidden
					/>
					{openStatusLabel(openStatus)}
				</span>
```

- [ ] **Step 3: Verifica a schermo, light e dark**

Il dev server customer gira su `http://localhost:3001` (avvialo con `bun run dev:customer` dalla root se serve). Il seed ha 23 negozi senza orari, quindi compaiono senza doverli fabbricare.

1. Apri `http://localhost:3001/stores` e trova un negozio con «Orari non indicati»: deve avere il punto interrogativo, non l'orologio.
2. Aprilo: la copertina deve mostrare lo stesso testo e la stessa icona.
3. Passa alla vista mappa e apri il popup di uno di quei negozi: l'etichetta deve essere «Orari non indicati» (niente icona lì, è corretto).
4. Ripeti in dark: nella console `localStorage.setItem('theme','dark')` e ricarica.

Expected: nessun «Chiuso» su un negozio senza orari in nessuna delle tre superfici. **Il rail degli orari nella scheda dirà ancora «Chiuso» sette volte: è il Task 3, non un fallimento di questo.**

- [ ] **Step 4: Typecheck e commit**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
bun run --filter @bibs/customer typecheck; echo "exit $?"
git add apps/customer/src/features/stores/store-tile.tsx \
        apps/customer/src/features/stores/store-cover.tsx
git commit -F - <<'EOF'
feat(customer): icona distinta per i negozi senza orari

Il punto interrogativo al posto dell'orologio: l'orologio allude a un orario,
e qui l'orario non esiste. Il tono resta quello di "Chiuso" perche' smorzarlo
porterebbe il contrasto a 3,05 in light e 3,49 in dark, sotto la soglia AA
di 4,5 per il testo piccolo.

Il popup della mappa non ha icona e non serve toccarlo: prende l'etichetta
nuova da openStatusLabel.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Il rail della scheda negozio smette di dire «Chiuso» sette volte

**Files:**
- Modify: `apps/customer/src/features/stores/format-opening-hours.ts` (append)
- Modify: `apps/customer/src/features/stores/opening-hours.tsx:14-32`
- Modify: `apps/customer/messages/it.json:79`
- Modify: `apps/customer/messages/en.json:79`
- Test: `apps/customer/src/features/stores/format-opening-hours.test.ts` (append)

**Interfaces:**
- Produces: `hasDeclaredHours(openingHours: OpeningHoursDayInput[] | null): boolean` da `format-opening-hours.ts`.

`formatWeeklyHours` **non cambia**: come formattatore è corretto — restituisce sette righe perché la settimana ha sette giorni. È il componente che deve decidere di non renderla. Il test esistente «returns 7 rows Lun→Dom, all closed when openingHours is null» resta valido e non va toccato.

- [ ] **Step 1: Scrivi il test fallito del predicato**

Appendi a `apps/customer/src/features/stores/format-opening-hours.test.ts`, e aggiungi `hasDeclaredHours` all'import esistente in cima al file:

```ts
// l'import in cima diventa:
import {
	formatWeeklyHours,
	hasDeclaredHours,
	romeDayOfWeek,
} from "./format-opening-hours";

describe("hasDeclaredHours", () => {
	it("is false for null, for [] and for days with no slots", () => {
		expect(hasDeclaredHours(null)).toBe(false);
		expect(hasDeclaredHours([])).toBe(false);
		expect(hasDeclaredHours([{ dayOfWeek: 0, slots: [] }])).toBe(false);
	});

	it("is true as soon as one day has a slot", () => {
		expect(
			hasDeclaredHours([
				{ dayOfWeek: 0, slots: [] },
				{ dayOfWeek: 3, slots: [{ open: "09:00", close: "13:00" }] },
			]),
		).toBe(true);
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `cd apps/customer && bun test src/features/stores/format-opening-hours.test.ts`
Expected: FAIL — `hasDeclaredHours is not a function` / errore di import.

- [ ] **Step 3: Implementa il predicato**

Appendi a `apps/customer/src/features/stores/format-opening-hours.ts`:

```ts
/**
 * Il negozio ha dichiarato almeno una fascia? `[]` e `slots: []` valgono quanto
 * `null`. Gemella del predicato che decide `status: "unknown"` lato API
 * (`apps/api/src/lib/holidays/open-status.ts`): badge e rail stanno sulla
 * stessa schermata, quindi devono rispondere alla stessa domanda.
 */
export function hasDeclaredHours(
	openingHours: OpeningHoursDayInput[] | null,
): boolean {
	return openingHours?.some((d) => d.slots.length > 0) ?? false;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `cd apps/customer && bun test src/features/stores/format-opening-hours.test.ts`
Expected: PASS — sia i test nuovi sia i preesistenti su `formatWeeklyHours`.

- [ ] **Step 5: Aggiungi il messaggio i18n**

In `apps/customer/messages/it.json`, subito dopo `"store_hours_title"` (riga 79):

```json
	"store_hours_unknown": "Il negozio non ha ancora indicato gli orari.",
```

In `apps/customer/messages/en.json`, nella stessa posizione:

```json
	"store_hours_unknown": "This shop hasn't published its opening hours yet.",
```

Attenzione alle virgole JSON: la riga precedente deve finire con `,`.

- [ ] **Step 6: Il componente non rende la tabella quando non c'è nulla da rendere**

In `apps/customer/src/features/stores/opening-hours.tsx`, aggiungi `hasDeclaredHours` all'import da `./format-opening-hours` e inserisci il ramo in cima al componente:

```tsx
export function OpeningHours({
	openingHours,
}: {
	openingHours: OpeningHoursDayInput[] | null;
}) {
	// Senza nessuna fascia dichiarata, le sette righe non sarebbero una
	// formattazione sbagliata: sarebbero sette affermazioni sbagliate. Lo dice
	// una riga sola, coerente col badge sulla copertina.
	if (!hasDeclaredHours(openingHours)) {
		return (
			<p className="rounded-lg border border-border px-3 py-2.5 text-[0.8125rem] text-muted-foreground">
				{m.store_hours_unknown()}
			</p>
		);
	}

	const dayLabels: DayLabels = [
		// ...invariato
```

Il resto della funzione resta identico. Le costanti `dayLabels` non sono hook, quindi il return anticipato è legittimo.

- [ ] **Step 7: Verifica a schermo**

1. Su `http://localhost:3001/stores` apri un negozio senza orari.
2. Il rail «Orari» deve mostrare **una riga sola**, non sette «Chiuso».
3. Apri un negozio *con* gli orari: la tabella dei sette giorni deve essere invariata, con il giorno corrente evidenziato.
4. Ripeti in dark.

Expected: sulla scheda di un negozio senza orari non compare la parola «Chiuso» da nessuna parte.

- [ ] **Step 8: Typecheck, test e commit**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
bun run --filter @bibs/customer typecheck; echo "exit $?"
cd apps/customer && bun test; echo "test exit $?"
cd /Users/marcogelli/repos/jelaz/bibs
git add apps/customer/src/features/stores/format-opening-hours.ts \
        apps/customer/src/features/stores/format-opening-hours.test.ts \
        apps/customer/src/features/stores/opening-hours.tsx \
        apps/customer/messages/it.json apps/customer/messages/en.json
git commit -F - <<'EOF'
feat(customer): il rail orari non dichiara sette chiusure inesistenti

Con openingHours null il rail della scheda negozio rendeva "Chiuso" per
tutti e sette i giorni: sette affermazioni sbagliate, non una formattazione
sbagliata. Era il finding rimasto aperto in #166.

formatWeeklyHours resta com'e' (sette righe sono corrette per un
formattatore della settimana): a decidere e' il componente, tramite un
predicato puro e testato, gemello di quello che l'API usa per "unknown".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Il seller — avviso riparato e sollecito nel profilo

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/index.tsx:96-121`
- Modify: `apps/seller/src/features/stores/components/store-form.tsx:281-291`

**Interfaces:**
- Consumes: `openStatus.status === "unknown"` dal Task 1, che arriva al seller via `composed.ts:35` (`t.Optional(t.Nullable(OpenStatusSchema))`).

- [ ] **Step 1: Separa il ramo «orari mancanti» nella dashboard**

In `apps/seller/src/routes/_authenticated/index.tsx`, sostituisci il blocco `const hoursAction: ActionItem | null = …` (righe ~100-117) con:

```tsx
	// Tre esiti distinti (nessun avviso / orari mai impostati / chiuso adesso)
	// non stanno in un ternario leggibile: IIFE con tipo di ritorno esplicito.
	const hoursAction = ((): ActionItem | null => {
		if (!openStatus) return null;

		// Non e' "chiuso": e' un profilo incompleto, e la conseguenza concreta
		// e' che il negozio sparisce dai risultati "Aperti ora".
		if (openStatus.status === "unknown") {
			return {
				id: "hours-missing",
				urgency: "medium",
				title: "Orari non ancora impostati",
				subtitle:
					'Senza orari il negozio non compare nei risultati "Aperti ora"',
				href: "/store",
				icon: Clock,
			};
		}

		if (openStatus.isOpen) return null;

		return {
			id: "hours-status",
			urgency: openStatus.status === "closed_holiday" ? "medium" : "low",
			title:
				openStatus.status === "closed_holiday"
					? "Oggi il negozio è chiuso"
					: "Negozio chiuso ora",
			subtitle:
				openStatus.status === "closed_holiday"
					? "Festività o chiusura programmata"
					: openStatus.opensAt
						? `Riapre il ${toYMD(openStatus.opensAt.date)} alle ${openStatus.opensAt.time}`
						: "Nessuna riapertura nei prossimi 60 giorni",
			href: "/store/closures",
			icon: Clock,
		};
	})();
```

Due correzioni oltre al ramo nuovo, entrambe conseguenza del Task 1:

- l'`href` del caso «orari mancanti» è `/store` (il profilo, dove gli orari si modificano) e non `/store/closures`, dove non si modificano;
- il fallback «Nessun orario impostato» diventa «Nessuna riapertura nei prossimi 60 giorni»: copriva il caso senza orari, che ora ha un ramo suo, e l'unico caso residuo è una chiusura più lunga della finestra di lookahead.

- [ ] **Step 2: Aggiungi il sollecito nel profilo negozio**

In `apps/seller/src/features/stores/components/store-form.tsx`, accanto agli altri `const` derivati (vicino a `openingHoursDirty`, riga ~118), aggiungi:

```tsx
	const hasDeclaredHours = openingHours.some((d) => d.slots.length > 0);
```

e nella `FormSection` «Orari di apertura» (riga ~281), sopra `<OpeningHoursEditor …/>`:

```tsx
			<FormSection
				title="Orari di apertura"
				description="Fasce orarie per ogni giorno. Le festività particolari si gestiscono dal calendario."
			>
				{!hasDeclaredHours && (
					<p className="mb-4 rounded-md border border-warm-line bg-warm-paper px-3 py-2 text-muted-foreground text-sm">
						Senza orari il negozio non compare nei risultati «Aperti ora» della
						ricerca.
					</p>
				)}
				<OpeningHoursEditor
					value={openingHours}
					onChange={setOpeningHours}
					readOnly={readOnly}
					dayErrors={hoursErrors}
				/>
			</FormSection>
```

`warm-line` e `warm-paper` sono token esistenti del tema seller; non inventarne altri.

- [ ] **Step 3: Verifica a schermo sul seller autenticato**

Il seller gira su `http://localhost:3002` (`bun run dev:seller`); `:3003` è l'admin. Accedi con `seller@dev.bibs` / `password123` — la verifica va fatta su una pagina autenticata vera, non su un mock.

1. Dashboard: se il negozio attivo non ha orari, l'avviso deve dire «Orari non ancora impostati», non «Negozio chiuso ora», con il pallino `medium`.
2. Clicca l'avviso: deve portare a `/store`, non a `/store/closures`.
3. Su `/store`, la sezione «Orari di apertura» deve mostrare la riga di sollecito sopra l'editor.
4. Compila una fascia e salva: la riga di sollecito sparisce e l'avviso in dashboard cambia di conseguenza.

Se il negozio del seller di sviluppo ha già gli orari, usane uno senza (nel seed sono il 27%) o svuota le fasce e salva.

- [ ] **Step 4: Typecheck e commit**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
bun run --filter @bibs/seller typecheck; echo "exit $?"
git add apps/seller/src/routes/_authenticated/index.tsx \
        apps/seller/src/features/stores/components/store-form.tsx
git commit -F - <<'EOF'
feat(seller): distingue "orari mai impostati" da "chiuso adesso"

La dashboard intitolava "Negozio chiuso ora" un negozio di cui non sapeva
nulla, col sottotitolo "Nessun orario impostato" a contraddire il titolo, e
mandava a /store/closures, dove gli orari non si modificano.

Ora il caso ha un ramo suo, urgency medium e href al profilo, e il sollecito
compare anche nella sezione orari del form, dove il seller puo' rimediare:
dice la conseguenza concreta, non un generico "compila il profilo".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Via l'anteprima, verifica finale

**Files:**
- Delete: `apps/customer/src/routes/preview-open-status.tsx`
- Modify: `apps/customer/src/routeTree.gen.ts` (rigenerato, **tracciato**)

- [ ] **Step 1: Cancella la route temporanea**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
git rm apps/customer/src/routes/preview-open-status.tsx
```

- [ ] **Step 2: Rigenera `routeTree.gen.ts`**

Il file è generato **ma tracciato**, e lo rigenera il plugin Vite (build o dev), non `tsc`. Se non lo rigeneri e committi, la CI typecheck va rossa mentre in locale resta verde.

```bash
cd /Users/marcogelli/repos/jelaz/bibs
bun run --filter @bibs/customer build; echo "build exit $?"
grep -c "preview-open-status" apps/customer/src/routeTree.gen.ts || echo "0 occorrenze — corretto"
```
Expected: build a exit 0 e **zero** occorrenze di `preview-open-status` nel route tree.

- [ ] **Step 3: Verifica che nessun residuo dell'anteprima sia rimasto**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
git grep -n "preview-open-status" -- . ':!docs/' || echo "nessun residuo fuori da docs/"
```
Expected: nessun risultato fuori da `docs/` (spec e piano lo citano di proposito).

- [ ] **Step 4: Suite completa e typecheck di ogni workspace**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
bun run test; echo "test exit $?"
for w in @bibs/api @bibs/customer @bibs/seller @bibs/admin; do
  bun run --filter "$w" typecheck; echo "$w -> exit $?";
done
bun run lint; echo "lint exit $?"
```
Expected: `exit 0` ovunque. Attenzione ai due falsi verdi noti: un `0 fail` con exit 1 va trattato come rosso, e l'exit code aggregato di `--filter '*'` non sostituisce i quattro typecheck separati.

- [ ] **Step 5: Commit**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
git add apps/customer/src/routeTree.gen.ts
git commit -F - <<'EOF'
chore(customer): rimuove la route di anteprima delle varianti

Serviva a scegliere la resa dello stato "orari non indicati" ed e' esaurita.
routeTree.gen.ts e' rigenerato: e' generato ma tracciato, e senza il rigenero
la CI typecheck sarebbe rossa con il locale verde.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Smoke manuale prima della PR**

Su UI il gate è «Marco l'ha provata», non «i test sono verdi». Prima di aprire la PR, ripercorri con mouse **e** tastiera:

1. `/stores` — griglia: negozi senza orari con punto interrogativo e «Orari non indicati».
2. `/stores` — vista mappa: popup con la stessa etichetta.
3. `/stores` — toggle «Aperti ora»: i negozi senza orari spariscono, il conteggio del facet non è cambiato di forma.
4. Scheda negozio: badge in copertina e rail orari **concordi**, niente «Chiuso».
5. Seller su `:3002`: avviso in dashboard, link a `/store`, sollecito nel form.
6. Tutto quanto sopra anche in dark.

Riporta cosa hai verificato e cosa no. Poi apri la PR con `/commit-commands:commit-push-pr`.

---

## Self-review

**Copertura della spec**

| Sezione della spec | Task |
|---|---|
| Il dominio (`unknown`, predicato, `isOpen: false`) | 1, step 3-5 |
| La gemella SQL non si tocca | 1, step 9 (verifica) |
| Contratto API + 3 default dei service | 1, step 6-7 |
| Customer: `openStatusLabel` | 1, step 10-12 |
| Customer: `use-store-search` union duplicata | 1, step 13 |
| Customer: icone tile e copertina | 2 |
| Customer: `store-search-map` nessuna modifica | 2 (dichiarato) |
| Customer: rail orari + messaggi i18n | 3 |
| Seller: dashboard + profilo | 4 |
| Cosa non cambia (facet, `openNowCondition`, DB) | nessun task li tocca |
| Test elencati nella spec | 1 (step 1, 8), 3 (step 1) |
| Route di anteprima da cancellare | 5 |
| Rischio `routeTree.gen.ts` | 5, step 2-3 |
| Rischio union esaustive / typecheck per workspace | 1 step 15, 5 step 4 |

Nessuna sezione della spec resta senza task.

**Coerenza dei nomi fra task**

- `hasDeclaredHours` è il nome del predicato esportato in `format-opening-hours.ts` (Task 3) **e** del `const` locale in `store-form.tsx` (Task 4). Sono due moduli in due app diverse senza import reciproco: nessun conflitto, e il nome uguale è voluto perché la domanda è la stessa.
- `OpenStatusView` (customer) e `OpenStatus` (API) restano due tipi distinti con la stessa union, come già oggi.
- `openStatusLabel` ha la stessa firma prima e dopo.
