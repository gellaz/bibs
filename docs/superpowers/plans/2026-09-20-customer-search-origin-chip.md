# Origine della ricerca nel chip — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare al customer una sola nozione di "da dove sto cercando" — GPS, un indirizzo salvato o nessuna origine — scelta da un chip nella top app bar e letta da home, lista negozi, facet e mappa.

**Architecture:** Un provider React montato in `_authenticated` possiede la scelta (persistita in `localStorage` come puntatore, mai coordinate) e la risolve contro la rubrica indirizzi e la geolocalizzazione del browser. Le regole di risoluzione stanno in un modulo puro testato (`search-origin-state.ts`), la geolocalizzazione diventa un dettaglio interno del provider, e `/stores` sincronizza l'origine con un solo parametro d'URL (`near=gps` o `near=<addressId>`) in due effetti con guardia esplicita.

**Tech Stack:** TanStack Start + Router (search params tipizzati), TanStack Query, React 19 context, Paraglide (copy in `messages/{it,en}.json`), `@bibs/ui` (Popover desktop / Drawer mobile, `useIsMobile`), `bun test` per il dominio puro.

**Spec:** `docs/superpowers/specs/2026-09-18-customer-address-book-design.md` — sezione **3. L'origine della ricerca (il chip)**; le PR 1 e 2 sono in main (`39c1cc2`, `fedcc14`, `90431b5`).

## Global Constraints

- **Branch:** `feat/customer-search-origin`, mai commit diretti su `main`; PR titolo `feat(customer): origine della ricerca nel chip`.
- **Copy sempre in Paraglide**, mai hardcoded: ogni stringa va in `apps/customer/messages/it.json` **e** `en.json`, con la stessa chiave e lo stesso ordine di inserimento (in coda).
- **Le coordinate non entrano mai nell'URL né in `localStorage`.** Nell'URL va solo `near=gps` o `near=<addressId>`; in `localStorage` solo `{ kind, addressId }`.
- **Il prompt dei permessi non scatta mai da solo.** Si legge `navigator.permissions.query({ name: "geolocation" })` in try/catch e si chiede la posizione in silenzio solo se è già `granted`; in ogni altro caso serve un tocco del cliente.
- **Ogni accesso a `localStorage` è in try/catch** (Safari privato, storage bloccato): il fallimento non deve rompere la pagina.
- **Niente lettura di `localStorage` durante il render**: l'app è SSR, la scelta si risolve in un `useEffect` di boot.
- **`{x, y}` → `{lat, lng}`**: nell'API `location.x` è la longitudine e `location.y` la latitudine (`PointXY` in `apps/api/src/lib/schemas/entities.ts:8`). Un'inversione manda la ricerca in un altro continente.
- **Nessuna modifica all'API.** Questa PR è solo `apps/customer` (più zero righe in `packages/ui`): gli endpoint accettano già `lat`/`lng`/`radius`.
- **Badge/etichette al singolare, tab/filtri al plurale** (convenzione di copy del repo).
- **Tap target ≥ 44px su mobile** (`min-h-11`), come le card della rubrica.
- Prima di dire "fatto": `bun run lint`, `bun run typecheck`, `bun test` e `bun run build` in `apps/customer`, più lo smoke nel browser su `localhost:3001` con `customer1@test.com` / `password123`.

---

## Struttura dei file

**Nuovi** — `apps/customer/src/features/location/`:

| file | responsabilità |
|---|---|
| `coords.ts` | il tipo `Coords` (`{ lat, lng }`), foglia senza dipendenze |
| `use-geolocation.ts` | geolocalizzazione del browser + sonda dei permessi; spostato da `features/discovery/`, diventa dettaglio interno del provider |
| `search-origin-state.ts` | dominio puro: parsing della scelta persistita, scelta di boot, risoluzione in origine, mappatura da/verso `near` |
| `search-origin-state.test.ts` | i test del modulo puro |
| `search-origin.tsx` | il provider `SearchOriginProvider` + hook `useSearchOrigin()` |
| `origin-label.ts` | l'etichetta leggibile di un'origine (paraglide) |
| `search-origin-chip.tsx` | il chip nella top app bar: Popover su desktop, Drawer su mobile |

**Modificati:**

| file | perché |
|---|---|
| `src/routes/_authenticated.tsx` | monta il provider sopra header e `Outlet` |
| `src/components/site-header.tsx` | ospita il chip |
| `src/features/discovery/nearby-products.tsx` | legge l'origine invece del proprio GPS |
| `src/features/discovery/use-nearby-products.ts` | import di `Coords` dalla nuova sede |
| `src/features/stores/use-store-search.ts`, `use-store-facets.ts`, `use-store-map.ts` | idem |
| `src/features/stores/store-filters.tsx` | il rail parla di origine, non di permesso GPS |
| `src/routes/_authenticated/stores/index.tsx` | `near` in URL, adozione/rispecchiamento, `radiusApplies` |
| `src/features/addresses/address-card.tsx` | azione "Cerca qui vicino" |
| `src/features/addresses/address-search.tsx` | il bias del geocoder viene dall'origine condivisa |
| `src/features/addresses/use-geocode.ts` | via `useBiasPosition`, il provider lo ha sostituito |
| `messages/it.json`, `messages/en.json` | copy nuova, e via quella morta |
| `src/features/discovery/use-geolocation.ts` | **cancellato** (spostato in `features/location/`) |

---

### Task 1: `features/location` — la geolocalizzazione cambia casa e impara a sondare i permessi

Oggi `Coords` e `useGeolocation` vivono in `features/discovery/use-geolocation.ts` e li importano quattro hook che con la "discovery" non c'entrano. Prima di aggiungere il provider, la nozione di posizione si sposta in una feature propria — e `useGeolocation` guadagna la sonda dei permessi che oggi è duplicata in `use-geocode.ts` (`useBiasPosition`).

**Files:**
- Create: `apps/customer/src/features/location/coords.ts`
- Create: `apps/customer/src/features/location/use-geolocation.ts`
- Delete: `apps/customer/src/features/discovery/use-geolocation.ts`
- Modify: `apps/customer/src/features/discovery/use-nearby-products.ts`, `apps/customer/src/features/discovery/nearby-products.tsx`, `apps/customer/src/features/stores/use-store-search.ts`, `apps/customer/src/features/stores/use-store-facets.ts`, `apps/customer/src/features/stores/use-store-map.ts`, `apps/customer/src/features/stores/store-filters.tsx`, `apps/customer/src/routes/_authenticated/stores/index.tsx`

**Interfaces:**
- Produces: `Coords = { lat: number; lng: number }` da `@/features/location/coords`; `useGeolocation(): { coords: Coords | null; status: GeoStatus; request: () => void }` e `type GeoStatus = "probing" | "idle" | "pending" | "granted" | "denied" | "unsupported"` da `@/features/location/use-geolocation`.

- [ ] **Step 1: Crea il tipo foglia**

`apps/customer/src/features/location/coords.ts`:

```ts
/**
 * Un punto, nella forma che le query dell'API già parlano (`lat`/`lng`). Vive
 * da solo perché lo importano hook, componenti e dominio puro: un tipo di base
 * non deve trascinarsi dietro un hook di React.
 */
export interface Coords {
	lat: number;
	lng: number;
}
```

- [ ] **Step 2: Sposta l'hook e aggiungi la sonda dei permessi**

`apps/customer/src/features/location/use-geolocation.ts` (nuovo file; `features/discovery/use-geolocation.ts` va cancellato):

```ts
import { useCallback, useEffect, useState } from "react";
import type { Coords } from "./coords";

export type GeoStatus =
	/** Sonda dei permessi in corso: non si sa ancora niente. */
	| "probing"
	| "idle"
	| "pending"
	| "granted"
	| "denied"
	| "unsupported";

/**
 * La geolocalizzazione del browser come flusso di permesso riusabile: una
 * lettura sola, bassa precisione, timeout 8s e cache 5 minuti.
 *
 * All'avvio **sonda** il permesso: se il consenso c'è già legge la posizione in
 * silenzio, altrimenti resta in `idle` e tocca a un gesto del cliente chiamare
 * `request()`. Nessun prompt parte da solo — è la regola della spec, e vale per
 * tutta l'app da quando questo hook è l'unico posto che chiama il browser.
 */
export function useGeolocation() {
	const [coords, setCoords] = useState<Coords | null>(null);
	const [status, setStatus] = useState<GeoStatus>("probing");

	const request = useCallback(() => {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			setStatus("unsupported");
			return;
		}
		setStatus("pending");
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
				setStatus("granted");
			},
			() => setStatus("denied"),
			{ enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
		);
	}, []);

	useEffect(() => {
		let cancelled = false;
		async function probe() {
			if (typeof navigator === "undefined" || !navigator.geolocation) {
				setStatus("unsupported");
				return;
			}
			try {
				const result = await navigator.permissions.query({
					name: "geolocation" as PermissionName,
				});
				if (cancelled) return;
				if (result.state === "granted") request();
				else if (result.state === "denied") setStatus("denied");
				else setStatus("idle");
			} catch {
				// Permissions API assente o senza `geolocation` (il supporto Safari
				// è irregolare): non indoviniamo, aspettiamo un gesto.
				if (!cancelled) setStatus("idle");
			}
		}
		void probe();
		return () => {
			cancelled = true;
		};
	}, [request]);

	return { coords, status, request };
}
```

- [ ] **Step 3: Ripunta gli import**

In `use-nearby-products.ts` sostituisci le due righe di `Coords`:

```ts
export type { Coords } from "@/features/location/coords";

import type { Coords } from "@/features/location/coords";
```

In `use-store-search.ts`, `use-store-facets.ts` e `use-store-map.ts`:

```ts
import type { Coords } from "@/features/location/coords";
```

In `store-filters.tsx`:

```ts
import type { GeoStatus } from "@/features/location/use-geolocation";
```

In `nearby-products.tsx` e `routes/_authenticated/stores/index.tsx`:

```ts
import { useGeolocation } from "@/features/location/use-geolocation";
```

- [ ] **Step 4: Verifica che non sia rimasto niente di appeso**

Run: `cd apps/customer && grep -rn "discovery/use-geolocation" src`
Expected: nessun risultato.

Run: `cd apps/customer && bun run typecheck && bun run lint`
Expected: entrambi verdi.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/features/location apps/customer/src/features/discovery apps/customer/src/features/stores apps/customer/src/routes/_authenticated/stores/index.tsx
git commit -m "refactor(customer): sposta la geolocalizzazione in features/location"
```

---

### Task 2: il dominio puro dell'origine (TDD)

Tutte le regole che decidono *quale* origine vale — la scelta persistita, il ripiego sull'indirizzo predefinito, l'indirizzo cancellato, la traduzione da/verso `near` — stanno qui, senza React e senza client API. È l'unico pezzo con abbastanza logica da meritare test, e li scriviamo prima.

**Files:**
- Create: `apps/customer/src/features/location/search-origin-state.test.ts`
- Create: `apps/customer/src/features/location/search-origin-state.ts`

**Interfaces:**
- Consumes: `Coords` da `./coords` (Task 1).
- Produces: `STORAGE_KEY`, `type StoredChoice`, `type SearchOrigin`, `interface OriginAddress`, `parseStoredChoice(raw: string | null): StoredChoice | null`, `serializeChoice(choice: StoredChoice): string`, `addressOriginLabel(address: OriginAddress): string`, `findOriginAddress(addresses: OriginAddress[], addressId: string): OriginAddress | null`, `defaultOriginAddress(addresses: OriginAddress[]): OriginAddress | null`, `bootChoice(ctx: { stored: StoredChoice | null; addresses: OriginAddress[]; gpsUsable: boolean }): StoredChoice`, `originFromChoice(choice: StoredChoice | null, ctx: { addresses: OriginAddress[]; gpsCoords: Coords | null }): SearchOrigin`, `nearFromOrigin(origin: SearchOrigin): string | undefined`, `choiceFromNear(near: string): StoredChoice`.

- [ ] **Step 1: Scrivi i test che falliscono**

`apps/customer/src/features/location/search-origin-state.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	addressOriginLabel,
	bootChoice,
	choiceFromNear,
	defaultOriginAddress,
	findOriginAddress,
	nearFromOrigin,
	originFromChoice,
	parseStoredChoice,
	serializeChoice,
} from "./search-origin-state";

const CASA = {
	id: "a-casa",
	label: "Casa",
	addressLine1: "Via Roma 12",
	isDefault: true,
	location: { x: 9.19, y: 45.4642 },
};

const LAVORO = {
	id: "a-lavoro",
	label: "  ",
	addressLine1: "Corso Buenos Aires 1",
	isDefault: false,
	location: { x: 9.2093, y: 45.4801 },
};

/** Una riga vecchia: l'API ammette `location` nulla, la rubrica no. */
const SENZA_POSIZIONE = {
	id: "a-vecchio",
	label: "Nonna",
	addressLine1: "Via Verdi 3",
	isDefault: false,
	location: null,
};

const MILANO = { lat: 45.4642, lng: 9.19 };

describe("parseStoredChoice", () => {
	it("accetta le tre forme che scriviamo noi", () => {
		expect(parseStoredChoice('{"kind":"gps"}')).toEqual({ kind: "gps" });
		expect(parseStoredChoice('{"kind":"none"}')).toEqual({ kind: "none" });
		expect(parseStoredChoice('{"kind":"address","addressId":"a-casa"}')).toEqual(
			{ kind: "address", addressId: "a-casa" },
		);
	});

	// `localStorage` è territorio ostile: ci scrive anche chi non siamo noi, e
	// una vecchia versione dell'app può averci lasciato un'altra forma.
	it("respinge tutto il resto senza esplodere", () => {
		expect(parseStoredChoice(null)).toBeNull();
		expect(parseStoredChoice("")).toBeNull();
		expect(parseStoredChoice("non-json")).toBeNull();
		expect(parseStoredChoice('"gps"')).toBeNull();
		expect(parseStoredChoice('{"kind":"altro"}')).toBeNull();
		expect(parseStoredChoice('{"kind":"address"}')).toBeNull();
		expect(parseStoredChoice('{"kind":"address","addressId":""}')).toBeNull();
	});

	it("rilegge quello che serializza", () => {
		const choice = { kind: "address", addressId: "a-casa" } as const;
		expect(parseStoredChoice(serializeChoice(choice))).toEqual(choice);
	});
});

describe("addressOriginLabel", () => {
	it("usa l'etichetta quando c'è", () => {
		expect(addressOriginLabel(CASA)).toBe("Casa");
	});

	it("ripiega sulla via quando l'etichetta è vuota o solo spazi", () => {
		expect(addressOriginLabel(LAVORO)).toBe("Corso Buenos Aires 1");
	});
});

describe("findOriginAddress / defaultOriginAddress", () => {
	it("trova l'indirizzo per id", () => {
		expect(findOriginAddress([CASA, LAVORO], "a-lavoro")).toBe(LAVORO);
	});

	it("non restituisce un indirizzo senza coordinate: non è un'origine", () => {
		expect(findOriginAddress([SENZA_POSIZIONE], "a-vecchio")).toBeNull();
		expect(defaultOriginAddress([{ ...SENZA_POSIZIONE, isDefault: true }])).toBeNull();
	});

	it("il predefinito è quello marcato, non il primo", () => {
		expect(defaultOriginAddress([LAVORO, CASA])).toBe(CASA);
		expect(defaultOriginAddress([LAVORO])).toBeNull();
	});
});

describe("bootChoice", () => {
	it("senza niente in memoria parte dall'indirizzo predefinito", () => {
		expect(
			bootChoice({ stored: null, addresses: [LAVORO, CASA], gpsUsable: false }),
		).toEqual({ kind: "address", addressId: "a-casa" });
	});

	it("senza niente in memoria e senza indirizzi non cerca da nessuna parte", () => {
		expect(bootChoice({ stored: null, addresses: [], gpsUsable: true })).toEqual({
			kind: "none",
		});
	});

	it("rispetta l'ultima scelta se l'indirizzo esiste ancora", () => {
		expect(
			bootChoice({
				stored: { kind: "address", addressId: "a-lavoro" },
				addresses: [CASA, LAVORO],
				gpsUsable: false,
			}),
		).toEqual({ kind: "address", addressId: "a-lavoro" });
	});

	// Il caso "indirizzo cancellato mentre era l'origine attiva" della spec.
	it("se l'indirizzo scelto non c'è più cade sul predefinito", () => {
		expect(
			bootChoice({
				stored: { kind: "address", addressId: "sparito" },
				addresses: [CASA, LAVORO],
				gpsUsable: false,
			}),
		).toEqual({ kind: "address", addressId: "a-casa" });
	});

	it("riprende il GPS solo se il permesso c'è già", () => {
		expect(
			bootChoice({ stored: { kind: "gps" }, addresses: [CASA], gpsUsable: true }),
		).toEqual({ kind: "gps" });
	});

	// Senza consenso non si può chiedere la posizione all'avvio senza far
	// scattare il prompt: si riparte da un indirizzo.
	it("senza consenso il GPS memorizzato ripiega sul predefinito", () => {
		expect(
			bootChoice({ stored: { kind: "gps" }, addresses: [CASA], gpsUsable: false }),
		).toEqual({ kind: "address", addressId: "a-casa" });
	});

	it('"Tutta l\'Italia" resta una scelta, non un ripiego da correggere', () => {
		expect(
			bootChoice({ stored: { kind: "none" }, addresses: [CASA], gpsUsable: true }),
		).toEqual({ kind: "none" });
	});
});

describe("originFromChoice", () => {
	it("traduce x/y in lng/lat, non il contrario", () => {
		const origin = originFromChoice(
			{ kind: "address", addressId: "a-casa" },
			{ addresses: [CASA], gpsCoords: null },
		);
		expect(origin).toEqual({
			kind: "address",
			addressId: "a-casa",
			label: "Casa",
			coords: { lat: 45.4642, lng: 9.19 },
		});
	});

	it("il GPS senza coordinate resta GPS: la UI lo dice invece di mentire", () => {
		expect(originFromChoice({ kind: "gps" }, { addresses: [CASA], gpsCoords: null })).toEqual({
			kind: "gps",
			coords: null,
		});
		expect(originFromChoice({ kind: "gps" }, { addresses: [], gpsCoords: MILANO })).toEqual({
			kind: "gps",
			coords: MILANO,
		});
	});

	it("un indirizzo sparito sotto i piedi cade sul predefinito", () => {
		const origin = originFromChoice(
			{ kind: "address", addressId: "sparito" },
			{ addresses: [CASA], gpsCoords: null },
		);
		expect(origin).toMatchObject({ kind: "address", addressId: "a-casa" });
	});

	it("senza predefinito su cui cadere resta senza origine", () => {
		expect(
			originFromChoice(
				{ kind: "address", addressId: "sparito" },
				{ addresses: [LAVORO], gpsCoords: null },
			),
		).toEqual({ kind: "none" });
	});

	// `null` = provider ancora in avvio: nessuna origine, nessuna query geografica.
	it("senza scelta non c'è origine", () => {
		expect(originFromChoice(null, { addresses: [CASA], gpsCoords: MILANO })).toEqual({
			kind: "none",
		});
		expect(originFromChoice({ kind: "none" }, { addresses: [CASA], gpsCoords: MILANO })).toEqual(
			{ kind: "none" },
		);
	});
});

describe("nearFromOrigin / choiceFromNear", () => {
	it("nell'URL finisce un puntatore, mai una coordinata", () => {
		expect(nearFromOrigin({ kind: "gps", coords: MILANO })).toBe("gps");
		expect(
			nearFromOrigin({
				kind: "address",
				addressId: "a-casa",
				label: "Casa",
				coords: MILANO,
			}),
		).toBe("a-casa");
		expect(nearFromOrigin({ kind: "none" })).toBeUndefined();
	});

	it("rilegge il parametro", () => {
		expect(choiceFromNear("gps")).toEqual({ kind: "gps" });
		expect(choiceFromNear("a-casa")).toEqual({ kind: "address", addressId: "a-casa" });
	});
});
```

- [ ] **Step 2: Falli girare e guardali fallire**

Run: `cd apps/customer && bun test src/features/location/search-origin-state.test.ts`
Expected: FAIL — `Cannot find module './search-origin-state'`.

- [ ] **Step 3: Scrivi il modulo**

`apps/customer/src/features/location/search-origin-state.ts`:

```ts
import type { Coords } from "./coords";

/** La chiave in `localStorage`. Solo la scelta: le coordinate scadono, un id no. */
export const STORAGE_KEY = "bibs-customer-search-origin";

/** Quello che persistiamo: un puntatore, non una posizione. */
export type StoredChoice =
	| { kind: "gps" }
	| { kind: "address"; addressId: string }
	| { kind: "none" };

/**
 * L'origine effettiva di una ricerca. `gps` può avere `coords: null` — permesso
 * non ancora concesso, o lettura fallita: la UI lo dice, e le query partono
 * senza filtro geografico invece di fingere una posizione.
 */
export type SearchOrigin =
	| { kind: "gps"; coords: Coords | null }
	| { kind: "address"; addressId: string; label: string; coords: Coords }
	| { kind: "none" };

/**
 * La parte di un indirizzo che serve qui. Strutturale di proposito: il tipo
 * Eden di `useAddresses` la soddisfa per forma, e il dominio resta testabile
 * senza il client API (stesso patto di `features/addresses/address-form-state.ts`).
 */
export interface OriginAddress {
	id: string;
	label: string | null;
	addressLine1: string;
	isDefault: boolean;
	location: { x: number; y: number } | null;
}

export function parseStoredChoice(raw: string | null): StoredChoice | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		const { kind, addressId } = parsed as {
			kind?: unknown;
			addressId?: unknown;
		};
		if (kind === "gps") return { kind: "gps" };
		if (kind === "none") return { kind: "none" };
		if (kind === "address" && typeof addressId === "string" && addressId) {
			return { kind: "address", addressId };
		}
		return null;
	} catch {
		return null;
	}
}

export function serializeChoice(choice: StoredChoice): string {
	return JSON.stringify(choice);
}

/** Come la rubrica intitola una card: l'etichetta se c'è, altrimenti la via. */
export function addressOriginLabel(address: OriginAddress): string {
	return address.label?.trim() || address.addressLine1;
}

/** Senza coordinate un indirizzo non è un'origine, per quanto sia salvato. */
function hasPosition(address: OriginAddress): boolean {
	return address.location !== null;
}

export function findOriginAddress(
	addresses: OriginAddress[],
	addressId: string,
): OriginAddress | null {
	return (
		addresses.find((a) => a.id === addressId && hasPosition(a)) ?? null
	);
}

export function defaultOriginAddress(
	addresses: OriginAddress[],
): OriginAddress | null {
	return addresses.find((a) => a.isDefault && hasPosition(a)) ?? null;
}

interface BootContext {
	stored: StoredChoice | null;
	addresses: OriginAddress[];
	/** Il GPS è riprendibile solo se il consenso c'è già: niente prompt d'ufficio. */
	gpsUsable: boolean;
}

/**
 * Con cosa parte l'app: l'ultima scelta se regge ancora, altrimenti
 * l'indirizzo predefinito, altrimenti nessuna origine.
 */
export function bootChoice({
	stored,
	addresses,
	gpsUsable,
}: BootContext): StoredChoice {
	if (stored?.kind === "none") return { kind: "none" };
	if (stored?.kind === "gps" && gpsUsable) return { kind: "gps" };
	if (stored?.kind === "address") {
		const found = findOriginAddress(addresses, stored.addressId);
		if (found) return { kind: "address", addressId: found.id };
	}
	const fallback = defaultOriginAddress(addresses);
	return fallback
		? { kind: "address", addressId: fallback.id }
		: { kind: "none" };
}

interface OriginContext {
	addresses: OriginAddress[];
	gpsCoords: Coords | null;
}

/**
 * La scelta diventa origine. Rivalutata a ogni render perché entrambi gli
 * ingressi cambiano sotto: le coordinate GPS arrivano in ritardo, e la rubrica
 * può perdere l'indirizzo scelto mentre lo si sta usando.
 */
export function originFromChoice(
	choice: StoredChoice | null,
	{ addresses, gpsCoords }: OriginContext,
): SearchOrigin {
	if (!choice || choice.kind === "none") return { kind: "none" };
	if (choice.kind === "gps") return { kind: "gps", coords: gpsCoords };

	const address =
		findOriginAddress(addresses, choice.addressId) ??
		defaultOriginAddress(addresses);
	if (!address?.location) return { kind: "none" };

	return {
		kind: "address",
		addressId: address.id,
		label: addressOriginLabel(address),
		// `x` è la longitudine e `y` la latitudine (PointXY dell'API).
		coords: { lat: address.location.y, lng: address.location.x },
	};
}

/** Il `near` dell'URL: un puntatore opaco, mai una coordinata. */
export function nearFromOrigin(origin: SearchOrigin): string | undefined {
	if (origin.kind === "gps") return "gps";
	if (origin.kind === "address") return origin.addressId;
	return undefined;
}

export function choiceFromNear(near: string): StoredChoice {
	return near === "gps"
		? { kind: "gps" }
		: { kind: "address", addressId: near };
}
```

- [ ] **Step 4: Falli girare e guardali passare**

Run: `cd apps/customer && bun test src/features/location/search-origin-state.test.ts`
Expected: PASS, tutti.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/features/location/search-origin-state.ts apps/customer/src/features/location/search-origin-state.test.ts
git commit -m "feat(customer): regole dell'origine della ricerca"
```

---

### Task 3: il provider condiviso

Un solo posto che sa da dove si cerca: possiede la scelta, la persiste, la risolve contro rubrica e GPS, e tiene aperto/chiuso il selettore (serve perché anche la home e il rail dei filtri devono poterlo aprire). Segue l'idioma di `apps/seller/src/hooks/use-active-store.tsx`: `createContext<T | null>(null)`, `.Provider`, hook che lancia fuori dal provider.

**Files:**
- Create: `apps/customer/src/features/location/search-origin.tsx`
- Modify: `apps/customer/src/routes/_authenticated.tsx`

**Interfaces:**
- Consumes: Task 1 (`Coords`, `useGeolocation`, `GeoStatus`), Task 2 (tutto `search-origin-state`), più `useAddresses()`/`AddressItem` da `@/features/addresses/use-addresses`.
- Produces: `<SearchOriginProvider>` e `useSearchOrigin(): SearchOriginValue` con i campi
  `origin: SearchOrigin`, `coords: Coords | null`, `isBooting: boolean`, `addresses: AddressItem[]`,
  `isAddressesPending: boolean`, `geoStatus: GeoStatus`, `gpsCoords: Coords | null`,
  `chooseGps(): void`, `chooseAddress(addressId: string): void`, `chooseNowhere(): void`,
  `requestGps(): void`, `adoptNear(near: string): boolean`,
  `pickerOpen: boolean`, `setPickerOpen(open: boolean): void`.

- [ ] **Step 1: Scrivi il provider**

`apps/customer/src/features/location/search-origin.tsx`:

```tsx
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AddressItem } from "@/features/addresses/use-addresses";
import { useAddresses } from "@/features/addresses/use-addresses";
import type { Coords } from "./coords";
import type { SearchOrigin, StoredChoice } from "./search-origin-state";
import {
	bootChoice,
	choiceFromNear,
	findOriginAddress,
	originFromChoice,
	parseStoredChoice,
	serializeChoice,
	STORAGE_KEY,
} from "./search-origin-state";
import type { GeoStatus } from "./use-geolocation";
import { useGeolocation } from "./use-geolocation";

interface SearchOriginValue {
	/** Da dove si sta cercando, adesso. */
	origin: SearchOrigin;
	/** Le coordinate dell'origine, o `null`: è quello che le query vogliono. */
	coords: Coords | null;
	/** Vero finché permessi e rubrica non hanno risposto: la UI non indovina. */
	isBooting: boolean;
	addresses: AddressItem[];
	isAddressesPending: boolean;
	geoStatus: GeoStatus;
	/** La posizione del browser, indipendente dalla scelta: serve al bias del geocoder. */
	gpsCoords: Coords | null;
	chooseGps: () => void;
	chooseAddress: (addressId: string) => void;
	chooseNowhere: () => void;
	/** Chiede la posizione senza cambiare origine (il form della rubrica). */
	requestGps: () => void;
	/**
	 * Fa vincere il `near` di un link, senza mai chiedere permessi.
	 * Restituisce `false` se quel `near` non risolve nulla — l'id di un altro
	 * cliente, o `gps` senza consenso — così la route può ripulire l'URL.
	 */
	adoptNear: (near: string) => boolean;
	pickerOpen: boolean;
	setPickerOpen: (open: boolean) => void;
}

const SearchOriginContext = createContext<SearchOriginValue | null>(null);

function readStoredChoice(): StoredChoice | null {
	try {
		return parseStoredChoice(window.localStorage.getItem(STORAGE_KEY));
	} catch {
		// Storage bloccato (Safari privato, cookie di terze parti): si riparte
		// dalle regole di default, non si esplode.
		return null;
	}
}

/**
 * L'origine della ricerca per tutta l'app autenticata. Sta sopra l'header
 * perché il chip vive lì, e sopra l'`Outlet` perché home, lista, facet e mappa
 * leggono la stessa cosa: prima della PR 3 c'erano due stati GPS scollegati.
 */
export function SearchOriginProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const { data, isPending: isAddressesPending } = useAddresses();
	const addresses = useMemo(() => data ?? [], [data]);
	const { coords: gpsCoords, status: geoStatus, request: requestGps } =
		useGeolocation();

	// `null` = non ancora deciso. Si legge `localStorage` qui e non in un
	// initializer di `useState` perché l'app è SSR: leggerlo in render
	// significherebbe un'idratazione che non combacia.
	const [choice, setChoice] = useState<StoredChoice | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const booted = useRef(false);

	useEffect(() => {
		if (booted.current) return;
		// Decidere prima di sapere se il permesso c'è e quali indirizzi esistono
		// vorrebbe dire mostrare "Tutta l'Italia" e poi cambiarlo sotto gli occhi.
		if (geoStatus === "probing" || isAddressesPending) return;
		booted.current = true;
		setChoice(
			bootChoice({
				stored: readStoredChoice(),
				addresses,
				gpsUsable: geoStatus === "granted" || geoStatus === "pending",
			}),
		);
	}, [geoStatus, isAddressesPending, addresses]);

	const commit = useCallback((next: StoredChoice) => {
		// Una scelta esplicita arrivata prima del boot vince sul boot.
		booted.current = true;
		setChoice(next);
		try {
			window.localStorage.setItem(STORAGE_KEY, serializeChoice(next));
		} catch {
			// La scelta vale per questa sessione e basta.
		}
	}, []);

	const chooseGps = useCallback(() => {
		commit({ kind: "gps" });
		// Il prompt del browser scatta qui: su un tocco, mai da solo.
		requestGps();
	}, [commit, requestGps]);

	const chooseAddress = useCallback(
		(addressId: string) => commit({ kind: "address", addressId }),
		[commit],
	);

	const chooseNowhere = useCallback(() => commit({ kind: "none" }), [commit]);

	const adoptNear = useCallback(
		(near: string): boolean => {
			const next = choiceFromNear(near);
			// Un `near` che non risolve **non tocca la scelta di chi lo riceve**:
			// il link di un altro non deve cancellargli l'origine salvata. Si dice
			// solo alla route che non ha attecchito, e l'URL si ripulisce.
			//
			// `near=gps` senza consenso non fa scattare il prompt: chi apre un
			// link non ha chiesto niente.
			if (next.kind === "gps" && geoStatus !== "granted") return false;
			if (
				next.kind === "address" &&
				!findOriginAddress(addresses, next.addressId)
			) {
				return false;
			}
			commit(next);
			return true;
		},
		[addresses, commit, geoStatus],
	);

	const origin = useMemo(
		() => originFromChoice(choice, { addresses, gpsCoords }),
		[choice, addresses, gpsCoords],
	);

	const value = useMemo<SearchOriginValue>(
		() => ({
			origin,
			coords: origin.kind === "none" ? null : origin.coords,
			isBooting: choice === null,
			addresses,
			isAddressesPending,
			geoStatus,
			gpsCoords,
			chooseGps,
			chooseAddress,
			chooseNowhere,
			requestGps,
			adoptNear,
			pickerOpen,
			setPickerOpen,
		}),
		[
			origin,
			choice,
			addresses,
			isAddressesPending,
			geoStatus,
			gpsCoords,
			chooseGps,
			chooseAddress,
			chooseNowhere,
			requestGps,
			adoptNear,
			pickerOpen,
		],
	);

	return (
		<SearchOriginContext.Provider value={value}>
			{children}
		</SearchOriginContext.Provider>
	);
}

export function useSearchOrigin() {
	const ctx = useContext(SearchOriginContext);
	if (!ctx) {
		throw new Error("useSearchOrigin va usato dentro SearchOriginProvider");
	}
	return ctx;
}
```

Nota sul tipo: `AddressItem` (inferito da Eden) soddisfa `OriginAddress` per forma, quindi `addresses` passa alle funzioni pure senza cast. Se il typecheck si lamenta, il posto da correggere è `OriginAddress`, non un `as`.

- [ ] **Step 2: Montalo in `_authenticated.tsx`**

Avvolge header e `Outlet` — il chip sta nell'header, le pagine nell'outlet, e devono leggere lo stesso stato:

```tsx
import { SearchOriginProvider } from "@/features/location/search-origin";

// …dentro AuthenticatedLayout, al posto del return finale:
	return (
		<SearchOriginProvider>
			<div className="flex min-h-screen flex-col bg-background">
				<SiteHeader />
				<main className="flex-1">
					<Outlet />
				</main>
			</div>
		</SearchOriginProvider>
	);
```

- [ ] **Step 3: Verifica**

Run: `cd apps/customer && bun run typecheck && bun run lint`
Expected: verdi. (Nessuno consuma ancora il provider: questo passo prova solo che compila e che l'app continua a girare.)

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/features/location/search-origin.tsx apps/customer/src/routes/_authenticated.tsx
git commit -m "feat(customer): provider dell'origine della ricerca"
```

---

### Task 4: il chip nella top app bar

Il selettore globale: `MapPin` + etichetta, `Popover` da `sm`, `Drawer` sotto. Il chip è **montato una volta sola** e cambia riga con il wrapping del flex, non con un ramo JS: due istanze (una nascosta con `max-sm:hidden`) aprirebbero **entrambe** il proprio contenuto, perché Popover e Drawer portano il pannello in un portal fuori dal wrapper nascosto.

**Files:**
- Create: `apps/customer/src/features/location/origin-label.ts`
- Create: `apps/customer/src/features/location/search-origin-chip.tsx`
- Modify: `apps/customer/src/components/site-header.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `useSearchOrigin()` (Task 3), `addressOriginLabel` (Task 2).
- Produces: `originLabel(origin: SearchOrigin, geoStatus: GeoStatus): string` da `./origin-label`; `<SearchOriginChip />` da `./search-origin-chip`.

- [ ] **Step 1: Copy in Paraglide (it e en)**

In coda a `apps/customer/messages/it.json` (prima della graffa di chiusura, aggiungendo la virgola alla riga precedente):

```json
	"origin_chip_aria": "Da dove cerchi",
	"origin_title": "Da dove cerchi",
	"origin_gps": "Posizione attuale",
	"origin_gps_locating": "Rilevamento…",
	"origin_gps_denied": "Posizione non disponibile: controlla i permessi del browser.",
	"origin_gps_unsupported": "Il tuo dispositivo non supporta la geolocalizzazione.",
	"origin_addresses_title": "I tuoi indirizzi",
	"origin_addresses_empty": "Non hai ancora salvato indirizzi.",
	"origin_everywhere": "Tutta l'Italia",
	"origin_everywhere_hint": "Nessun ordinamento per distanza",
	"origin_manage": "Gestisci indirizzi",
	"origin_choose": "Scegli da dove cercare",
	"origin_distances_from": "Distanze da {label}",
	"origin_search_here": "Cerca qui vicino",
	"store_distance_needs_origin": "Scegli da dove cercare per filtrare per distanza."
```

In coda a `apps/customer/messages/en.json`, le stesse chiavi nello stesso ordine:

```json
	"origin_chip_aria": "Where you're searching from",
	"origin_title": "Where you're searching from",
	"origin_gps": "Current location",
	"origin_gps_locating": "Locating…",
	"origin_gps_denied": "Location unavailable: check your browser permissions.",
	"origin_gps_unsupported": "Your device doesn't support geolocation.",
	"origin_addresses_title": "Your addresses",
	"origin_addresses_empty": "You haven't saved any address yet.",
	"origin_everywhere": "All of Italy",
	"origin_everywhere_hint": "No distance sorting",
	"origin_manage": "Manage addresses",
	"origin_choose": "Choose where to search from",
	"origin_distances_from": "Distances from {label}",
	"origin_search_here": "Search near here",
	"store_distance_needs_origin": "Choose where to search from to filter by distance."
```

Run: `cd apps/customer && bun run paraglide:compile`
Expected: compila senza warning di chiavi mancanti.

- [ ] **Step 2: L'etichetta dell'origine**

`apps/customer/src/features/location/origin-label.ts`:

```ts
import { m } from "@/paraglide/messages";
import type { SearchOrigin } from "./search-origin-state";
import type { GeoStatus } from "./use-geolocation";

/**
 * Come si chiama l'origine nella UI. Il GPS in attesa ha un nome suo:
 * "Posizione attuale" mentre il browser sta ancora cercando è una promessa non
 * ancora mantenuta.
 */
export function originLabel(
	origin: SearchOrigin,
	geoStatus: GeoStatus,
): string {
	if (origin.kind === "address") return origin.label;
	if (origin.kind === "gps") {
		return geoStatus === "pending" ? m.origin_gps_locating() : m.origin_gps();
	}
	return m.origin_everywhere();
}
```

- [ ] **Step 3: Il chip**

`apps/customer/src/features/location/search-origin-chip.tsx`:

```tsx
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@bibs/ui/components/drawer";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@bibs/ui/components/popover";
import { Separator } from "@bibs/ui/components/separator";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { useIsMobile } from "@bibs/ui/hooks/use-mobile";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
	Check,
	ChevronDown,
	Globe,
	LocateFixed,
	MapPin,
	Settings2,
} from "lucide-react";
import { m } from "@/paraglide/messages";
import { originLabel } from "./origin-label";
import { useSearchOrigin } from "./search-origin";
import { addressOriginLabel } from "./search-origin-state";

/** Alone saffron + anello Ink: la regola del focus di DESIGN.md. */
const FOCUS_RING =
	"outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron";

/**
 * Il selettore dell'origine. Sta nell'header perché "da dove cerco" è la prima
 * domanda di una ricerca locale, e perché da qui è raggiungibile da ogni
 * pagina — prima esisteva solo come bottone GPS dentro due schermate.
 */
export function SearchOriginChip() {
	const { origin, geoStatus, isBooting, pickerOpen, setPickerOpen } =
		useSearchOrigin();
	const isMobile = useIsMobile();

	const trigger = (
		<button
			type="button"
			disabled={isBooting}
			aria-label={m.origin_chip_aria()}
			className={`inline-flex min-h-11 max-w-[15rem] items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-foreground text-sm transition-colors hover:border-primary/40 hover:bg-muted sm:min-h-9 ${FOCUS_RING}`}
		>
			<MapPin
				className="size-4 shrink-0 text-saffron-deep dark:text-saffron"
				aria-hidden
			/>
			{isBooting ? (
				<Skeleton className="h-4 w-24" />
			) : (
				<span className="truncate font-medium">
					{originLabel(origin, geoStatus)}
				</span>
			)}
			<ChevronDown
				className="size-3.5 shrink-0 text-muted-foreground"
				aria-hidden
			/>
		</button>
	);

	// Una sola istanza montata: il pannello finisce in un portal, quindi due
	// copie "nascoste con il CSS" si aprirebbero tutte e due.
	if (isMobile) {
		return (
			<Drawer open={pickerOpen} onOpenChange={setPickerOpen}>
				<DrawerTrigger asChild>{trigger}</DrawerTrigger>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>{m.origin_title()}</DrawerTitle>
					</DrawerHeader>
					<div className="overflow-y-auto px-2 pb-8">
						<OriginOptions onPick={() => setPickerOpen(false)} />
					</div>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Popover open={pickerOpen} onOpenChange={setPickerOpen}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent align="start" className="w-80 gap-0 p-2">
				<p className="px-2 pt-1 pb-2 font-medium text-muted-foreground text-xs">
					{m.origin_title()}
				</p>
				<div className="max-h-[60vh] overflow-y-auto">
					<OriginOptions onPick={() => setPickerOpen(false)} />
				</div>
			</PopoverContent>
		</Popover>
	);
}

function OptionRow({
	icon: Icon,
	title,
	hint,
	active,
	disabled,
	onClick,
}: {
	icon: LucideIcon;
	title: string;
	hint?: string;
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-current={active ? "true" : undefined}
			className={`flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING} ${
				active
					? "bg-primary/10 text-primary"
					: "text-foreground enabled:hover:bg-muted"
			}`}
		>
			<Icon
				className={`size-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
				aria-hidden
			/>
			<span className="min-w-0 flex-1">
				<span className="block truncate font-medium text-sm">{title}</span>
				{hint && (
					<span className="block truncate text-muted-foreground text-xs">
						{hint}
					</span>
				)}
			</span>
			{active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
		</button>
	);
}

function OriginOptions({ onPick }: { onPick: () => void }) {
	const {
		origin,
		addresses,
		geoStatus,
		chooseGps,
		chooseAddress,
		chooseNowhere,
	} = useSearchOrigin();

	// Un indirizzo senza coordinate non può essere un'origine: la rubrica le
	// esige sui nuovi, ma le righe vecchie dell'API possono averle nulle.
	const usable = addresses.filter((a) => a.location !== null);

	const gpsHint =
		geoStatus === "pending"
			? m.origin_gps_locating()
			: geoStatus === "denied"
				? m.origin_gps_denied()
				: geoStatus === "unsupported"
					? m.origin_gps_unsupported()
					: undefined;

	return (
		<div className="space-y-0.5">
			<OptionRow
				icon={LocateFixed}
				title={m.origin_gps()}
				hint={gpsHint}
				active={origin.kind === "gps"}
				disabled={geoStatus === "unsupported"}
				onClick={() => {
					chooseGps();
					onPick();
				}}
			/>

			<p className="px-2 pt-3 pb-1 font-medium text-muted-foreground text-xs">
				{m.origin_addresses_title()}
			</p>
			{usable.length === 0 ? (
				<p className="px-2 pb-1 text-muted-foreground text-xs">
					{m.origin_addresses_empty()}
				</p>
			) : (
				usable.map((address) => (
					<OptionRow
						key={address.id}
						icon={MapPin}
						title={addressOriginLabel(address)}
						hint={`${address.addressLine1} · ${address.municipality.name}`}
						active={
							origin.kind === "address" && origin.addressId === address.id
						}
						onClick={() => {
							chooseAddress(address.id);
							onPick();
						}}
					/>
				))
			)}

			<div className="pt-3">
				<OptionRow
					icon={Globe}
					title={m.origin_everywhere()}
					hint={m.origin_everywhere_hint()}
					active={origin.kind === "none"}
					onClick={() => {
						chooseNowhere();
						onPick();
					}}
				/>
			</div>

			<Separator className="my-1" />
			<Link
				to="/addresses"
				onClick={onPick}
				className={`flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-primary text-sm transition-colors hover:bg-muted ${FOCUS_RING}`}
			>
				<Settings2 className="size-4 shrink-0" aria-hidden />
				{m.origin_manage()}
			</Link>
		</div>
	);
}
```

- [ ] **Step 4: Montalo nell'header**

In `apps/customer/src/components/site-header.tsx`: importa il chip e trasforma la riga in un flex che avvolge. Il contenitore e il chip:

```tsx
		<header className="sticky top-0 z-40 border-border border-b bg-background">
			<div
				className={`${PAGE_CONTAINER} flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 sm:h-16 sm:flex-nowrap sm:gap-4 sm:py-0`}
			>
				{/* …il Link del brand resta identico… */}

				{/* Sotto `sm` il chip scende su una riga sua: nella prima non ci
				    sta un'etichetta leggibile accanto a identità, navigazione e
				    borsa, e un tap target da 44px la riempirebbe. Da `sm` torna
				    accanto all'identità. Una sola istanza, spostata dal wrapping:
				    due copie aprirebbero due pannelli. */}
				<div className="max-sm:order-last max-sm:basis-full">
					<SearchOriginChip />
				</div>

				{/* …nav e UserMenu restano identici… */}
			</div>
		</header>
```

L'altezza fissa `h-14 sm:h-16` sparisce: su mobile l'header ha due righe e la sua altezza la decide il contenuto.

- [ ] **Step 5: Verifica**

Run: `cd apps/customer && bun run typecheck && bun run lint`
Expected: verdi.

Run: `cd apps/customer && bun run dev` e apri `http://localhost:3001` con `customer1@test.com` / `password123`
Expected: il chip compare nell'header; a 375px sta su una riga sua e apre un Drawer dal basso; da 640px apre un Popover. Senza indirizzi salvati mostra "Tutta l'Italia" e l'invito a gestirli.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/src/features/location apps/customer/src/components/site-header.tsx apps/customer/messages
git commit -m "feat(customer): chip dell'origine nella top app bar"
```

---

### Task 5: la home legge l'origine

La sezione "Vicino a te" perde il proprio bottone GPS: chiede l'origine al chip, e quando non ce n'è una invita a sceglierla aprendo il chip stesso.

**Files:**
- Modify: `apps/customer/src/features/discovery/nearby-products.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json` (copy morta)

**Interfaces:**
- Consumes: `useSearchOrigin()` (Task 3), `originLabel()` (Task 4).

- [ ] **Step 1: Sostituisci il GPS locale con l'origine condivisa**

In `nearby-products.tsx` cambiano gli import (via `useGeolocation`, dentro `useSearchOrigin` e `originLabel`) e l'intestazione della sezione:

```tsx
export function NearbyProducts() {
	const { origin, coords, geoStatus, setPickerOpen } = useSearchOrigin();
	const {
		data: products,
		isPending,
		isError,
		refetch,
	} = useNearbyProducts(coords);
```

Il blocco a destra del titolo diventa:

```tsx
				{coords ? (
					<span className="inline-flex items-center gap-1.5 text-saffron-deep text-sm dark:text-saffron">
						<LocateFixed className="size-4" aria-hidden />
						{m.origin_distances_from({ label: originLabel(origin, geoStatus) })}
					</span>
				) : (
					<Button
						variant="secondary"
						size="sm"
						className="min-h-11 sm:min-h-9"
						onClick={() => setPickerOpen(true)}
					>
						<MapPin className="size-4" aria-hidden />
						{m.origin_choose()}
					</Button>
				)}
```

Il paragrafo sotto (`geoStatus === "denied" || "unsupported"`) va **rimosso**: quella spiegazione ora vive nel selettore, accanto alla voce che la riguarda, invece che in una pagina che del GPS non parla più.

E i tile mostrano la distanza quando c'è un'origine, non quando c'è un permesso:

```tsx
								<ProductTile product={product} showDistance={coords !== null} />
```

- [ ] **Step 2: Togli la copy rimasta senza padrone**

Run: `cd apps/customer && for k in discovery_sorted_by_distance discovery_locating discovery_show_distances discovery_location_denied discovery_location_unsupported; do echo "$k: $(grep -rl "m.$k" src | wc -l)"; done`
Expected: `0` per tutte e cinque.

Cancella quelle cinque chiavi da `messages/it.json` e `messages/en.json` (in entrambi, stessa lista).

- [ ] **Step 3: Verifica**

Run: `cd apps/customer && bun run paraglide:compile && bun run typecheck && bun run lint`
Expected: verdi.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/features/discovery/nearby-products.tsx apps/customer/messages
git commit -m "feat(customer): la home cerca dall'origine scelta nel chip"
```

---

### Task 6: `/stores` — `near` nell'URL, e i quattro consumatori

La lista negozi è l'unica pagina con uno stato d'URL da tenere allineato all'origine. Qui il raggio smette di dipendere dal permesso GPS e comincia a dipendere dall'avere una posizione, che è la cosa che serviva davvero.

**Files:**
- Modify: `apps/customer/src/routes/_authenticated/stores/index.tsx`
- Modify: `apps/customer/src/features/stores/store-filters.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json` (copy morta)

**Interfaces:**
- Consumes: `useSearchOrigin()` (Task 3), `nearFromOrigin()` (Task 2), `originLabel()` (Task 4).
- Produces: `StoreFiltersProps` con `hasOrigin: boolean`, `originLabel: string`, `onChooseOrigin: () => void` al posto di `geoStatus`/`onRequestLocation`.

- [ ] **Step 1: `near` fra i search params**

In `stores/index.tsx`, nell'interfaccia e nel validatore:

```ts
interface StoreSearchParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	radius?: number;
	openNow?: boolean;
	view?: "map";
	/**
	 * Da dove si cerca: `gps` o l'id di un indirizzo. Mai coordinate — un link
	 * condiviso non deve dire dove abiti, e a chi lo riceve l'id non risolve
	 * nulla. Assente = si eredita l'origine attiva.
	 */
	near?: string;
}
```

```ts
		near: typeof search.near === "string" ? search.near : undefined,
```

- [ ] **Step 2: L'origine al posto del GPS, e i due effetti di sincronizzazione**

Import: via `useGeolocation`, dentro `useSearchOrigin`, `nearFromOrigin` e `originLabel`. La destrutturazione:

```tsx
	const { q, categoryId, macroCategoryId, radius, openNow, view, near } =
		Route.useSearch();
	const {
		origin,
		coords,
		geoStatus,
		isAddressesPending,
		adoptNear,
		setPickerOpen,
	} = useSearchOrigin();
```

Subito dopo gli effetti che già sincronizzano il testo di ricerca, aggiungi:

```tsx
	// `near` ⇄ origine, in due effetti con memoria.
	//
	// All'arrivo **vince il link**: `adoptedNear` ricorda quale valore dell'URL
	// abbiamo già consumato, così non lo si riadotta a ogni render. Un `near`
	// che non risolve nulla (l'indirizzo di un altro cliente, o `gps` senza
	// consenso) viene tolto dall'URL invece di restare lì a promettere
	// un'origine che non c'è.
	const adoptedNear = useRef<string | null>(null);
	useEffect(() => {
		// Un id di indirizzo non si può giudicare finché la rubrica non ha risposto.
		if (isAddressesPending) return;
		const key = near ?? null;
		if (adoptedNear.current === key) return;
		adoptedNear.current = key;
		if (key === null) return;
		if (!adoptNear(key)) {
			void navigate({
				search: (prev) => ({ ...prev, near: undefined }),
				replace: true,
			});
		}
	}, [near, isAddressesPending, adoptNear, navigate]);

	// …e da lì in poi **vince il chip**: quando l'origine cambia, l'URL la
	// rispecchia, così quello che si condivide è la vista che si sta guardando.
	// `lastOriginKey` parte indefinito di proposito: al primo giro non si
	// scrive niente, altrimenti l'origine ancora in avvio cancellerebbe il
	// `near` del link appena aperto.
	const lastOriginKey = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		const key = nearFromOrigin(origin) ?? null;
		const changed =
			lastOriginKey.current !== undefined && lastOriginKey.current !== key;
		lastOriginKey.current = key;
		if (!changed || (near ?? null) === key) return;
		adoptedNear.current = key;
		void navigate({
			search: (prev) => ({ ...prev, near: key ?? undefined }),
			replace: true,
		});
	}, [origin, near, navigate]);
```

- [ ] **Step 3: Il raggio dipende dalla posizione, non dal permesso**

```tsx
	// Senza posizione il raggio non viene inviato: contarlo tra i filtri attivi
	// annuncerebbe una restrizione che i risultati non hanno. Da questa PR una
	// posizione può venire anche da un indirizzo salvato, non solo dal GPS.
	const radiusApplies = radius !== undefined && coords !== null;
```

Nello stesso file sostituisci ogni `geoStatus === "granted"` rimasto con `coords !== null`: le due `<StoreTile … showDistance>`, la `showDistance` di `LazyStoreSearchMap` e `userCoords={coords}` (quest'ultima non cambia nome, cambia sorgente). Il rail riceve le nuove props:

```tsx
	const filters = (
		<StoreFilters
			macros={facets.macros}
			total={facets.total}
			openNowTotal={facets.openNowTotal}
			isPending={facets.isPending}
			value={filterValue}
			hasOrigin={coords !== null}
			originLabel={originLabel(origin, geoStatus)}
			onChooseOrigin={() => setPickerOpen(true)}
			onChange={applyFilters}
		/>
	);
```

- [ ] **Step 4: Il rail parla di origine**

In `store-filters.tsx`: via l'import di `GeoStatus`, dentro le nuove props.

```tsx
interface StoreFiltersProps {
	macros: MacroFacet[];
	total: number;
	/** Quanti negozi sono aperti adesso, a parità di testo e raggio. */
	openNowTotal: number;
	isPending: boolean;
	value: StoreFilterValue;
	/** C'è una posizione da cui misurare: GPS o un indirizzo salvato. */
	hasOrigin: boolean;
	originLabel: string;
	onChooseOrigin: () => void;
	onChange: (next: StoreFilterValue) => void;
}
```

Nella firma della funzione `geoStatus`/`onRequestLocation` diventano `hasOrigin`/`originLabel`/`onChooseOrigin`, sparisce `const hasPosition = geoStatus === "granted";` e ogni `hasPosition` diventa `hasOrigin`. La sezione distanza:

```tsx
			<FilterSection title={m.store_filter_distance()}>
				{hasOrigin ? (
					<p className="flex items-center gap-1.5 text-saffron-deep text-xs dark:text-saffron">
						<LocateFixed className="size-3.5 shrink-0" aria-hidden />
						{m.origin_distances_from({ label: originLabel })}
					</p>
				) : (
					<div className="space-y-2.5">
						<p className="text-muted-foreground text-xs leading-relaxed">
							{m.store_distance_needs_origin()}
						</p>
						<Button
							variant="secondary"
							size="sm"
							className="min-h-11 sm:min-h-9"
							onClick={onChooseOrigin}
						>
							<MapPin className="size-4" aria-hidden />
							{m.origin_choose()}
						</Button>
					</div>
				)}
```

- [ ] **Step 5: Togli la copy rimasta senza padrone**

Run: `cd apps/customer && for k in store_use_my_location store_locating store_distance_needs_location store_sorted_by_distance; do echo "$k: $(grep -rl "m.$k" src | wc -l)"; done`
Expected: `0` per tutte e quattro. Cancellale da `messages/it.json` e `messages/en.json`.

- [ ] **Step 6: Verifica**

Run: `cd apps/customer && bun run paraglide:compile && bun run typecheck && bun run lint`
Expected: verdi.

Run: `cd apps/customer && bun run dev`, poi nel browser:
1. `/stores` senza `near` con un indirizzo predefinito → l'URL diventa `?near=<id>` da solo, il rail dice "Distanze da Casa", i preset di raggio sono attivi.
2. Cambia origine dal chip → `near` segue, i risultati si riordinano.
3. `/stores?near=xxx-non-mio` → l'URL si ripulisce, il chip dice "Tutta l'Italia", nessun errore a schermo.
4. Vista mappa con `near=<id>` → i pin e le distanze partono dall'indirizzo.

- [ ] **Step 7: Commit**

```bash
git add apps/customer/src/routes/_authenticated/stores/index.tsx apps/customer/src/features/stores/store-filters.tsx apps/customer/messages
git commit -m "feat(customer): la ricerca negozi segue l'origine scelta"
```

---

### Task 7: la rubrica parla la stessa lingua

Due cose che la PR 2 ha lasciato aperte proprio in attesa di questa: l'azione *Cerca qui vicino* sulla card, e il bias del geocoder che oggi ha un GPS tutto suo (`useBiasPosition`, con il commento "la PR 3 sostituirà questo hook").

**Files:**
- Modify: `apps/customer/src/features/addresses/address-card.tsx`
- Modify: `apps/customer/src/features/addresses/address-search.tsx`
- Modify: `apps/customer/src/features/addresses/use-geocode.ts`

**Interfaces:**
- Consumes: `useSearchOrigin()` (Task 3), `Coords` (Task 1), la chiave `origin_search_here` (Task 4).
- Produces: `useGeocode(text: string, near: Coords | null)` resta l'unica esportazione di `use-geocode.ts` insieme a `GeocodeSuggestionItem`.

- [ ] **Step 1: "Cerca qui vicino" sulla card**

In `address-card.tsx`, come prima azione della riga (prima di *Modifica*), e solo quando l'indirizzo ha coordinate — senza, non è un'origine e il bottone porterebbe a una ricerca che non cambia niente:

```tsx
			{address.location && (
				<Button asChild variant="secondary" size="sm" className="min-h-11 sm:min-h-9">
					<Link
						to="/stores"
						search={{ near: address.id, q: undefined, categoryId: undefined }}
					>
						<Search className="size-4" aria-hidden />
						{m.origin_search_here()}
					</Link>
				</Button>
			)}
```

Import da aggiungere: `Link` da `@tanstack/react-router`, `Search` da `lucide-react`. Non serve toccare il provider: `/stores` adotta il `near` del link e da lì in poi il chip lo mostra.

- [ ] **Step 2: Il bias del geocoder viene dall'origine**

In `address-search.tsx` sostituisci `useBiasPosition` con l'origine condivisa:

```tsx
	const { origin, gpsCoords, geoStatus, requestGps } = useSearchOrigin();

	// L'ordine della spec: il GPS se il consenso c'è già, altrimenti l'origine
	// attiva quando è un indirizzo salvato — chi aggiunge il secondo indirizzo
	// di solito lo aggiunge vicino al primo — altrimenti nessun bias.
	const bias =
		geoStatus === "granted"
			? gpsCoords
			: origin.kind === "address"
				? origin.coords
				: null;

	const { data, isFetching, isError } = useGeocode(debounced, bias);
```

E il piede del campo, che ora legge `GeoStatus` invece di `BiasStatus`:

```tsx
			{(geoStatus === "idle" ||
				geoStatus === "denied" ||
				geoStatus === "pending") && (
				<Button
					type="button"
					variant="secondary"
					size="sm"
					className="mt-1 min-h-11 self-start sm:min-h-9"
					disabled={geoStatus === "pending"}
					onClick={requestGps}
				>
					<LocateFixed className="size-4" aria-hidden />
					{geoStatus === "pending"
						? m.address_search_locating()
						: m.address_search_use_location()}
				</Button>
			)}
			{geoStatus === "granted" && (
				<p className="mt-1 text-muted-foreground text-xs">
					{m.address_search_nearby_first()}
				</p>
			)}
```

Nota: `requestGps` chiede la posizione **senza** cambiare l'origine della ricerca. Compilare un indirizzo non è dire "cerca da qui".

- [ ] **Step 3: Via il GPS duplicato**

In `use-geocode.ts` cancella `BiasPosition`, `BiasStatus` e tutto `useBiasPosition` (con i suoi `useCallback`/`useEffect`/`useState`, che restano senza uso), e usa `Coords`:

```ts
import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/location/coords";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

async function fetchSuggestions(q: string, near: Coords | null) {
```

e la firma pubblica:

```ts
export function useGeocode(text: string, near: Coords | null) {
```

- [ ] **Step 4: Verifica che il GPS sia rimasto in un posto solo**

Run: `cd apps/customer && grep -rn "getCurrentPosition\|permissions.query" src`
Expected: solo `src/features/location/use-geolocation.ts`.

Run: `cd apps/customer && bun run typecheck && bun run lint && bun test`
Expected: verdi.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/features/addresses
git commit -m "feat(customer): la rubrica usa l'origine condivisa"
```

---

### Task 8: verifica e PR

**Files:** nessuno da scrivere — questo task è il cancello.

- [ ] **Step 1: I comandi, dalla radice**

Run: `bun run lint`
Expected: verde.

Run: `bun run typecheck`
Expected: verde su api e sui tre frontend (nessuna modifica all'API, ma Eden propaga: se qualcosa si è mosso, si vede qui).

Run: `cd apps/customer && bun test`
Expected: verde, inclusi i test di `search-origin-state`.

Run: `cd apps/customer && bun run build`
Expected: build completa. È il gate dell'SSR: Drawer e Popover finiscono in un portal e `useIsMobile` tocca `window`, quindi un errore di ambiente si vede qui e non in dev.

- [ ] **Step 2: `git status` pulito da sorprese**

Run: `git status --short`
Expected: nessun file generato non committato. In particolare `apps/customer/src/routeTree.gen.ts` **non** deve risultare modificato: questa PR non aggiunge route, tocca solo i search param di una esistente. Se risulta modificato, va committato (la CI typecheck lo rigenera e fallirebbe).

- [ ] **Step 3: Smoke nel browser, con le mani** — `bun run dev`, `http://localhost:3001`, `customer1@test.com` / `password123`

Il gate di questa PR è "Marco l'ha provata": i test verdi non dicono niente su un chip. Prova, nell'ordine, **con mouse e con tastiera**:

1. **Primo accesso senza indirizzi** → il chip dice "Tutta l'Italia"; il pannello mostra "Posizione attuale", "Non hai ancora salvato indirizzi" e "Gestisci indirizzi".
2. **Salva due indirizzi** da `/addresses` (uno predefinito) → ricarica: il chip parte dal predefinito, senza che sia scattato nessun prompt di permessi.
3. **Concedi la posizione** dal pannello → il chip passa a "Rilevamento…" e poi a "Posizione attuale"; la home mostra "Distanze da Posizione attuale".
4. **Ricarica** → la scelta regge, e il permesso già concesso non fa comparire nessun prompt.
5. **`/stores`** → l'URL guadagna `?near=…` da solo; cambia origine dal chip e guarda `near` seguire; i preset di raggio sono attivi anche con un indirizzo salvato (era impossibile prima di questa PR).
6. **Link di un altro**: apri `/stores?near=00000000-0000-0000-0000-000000000000` → nessun errore, l'URL si ripulisce, il chip resta su "Tutta l'Italia".
7. **Elimina l'indirizzo attivo** da `/addresses` → il chip ripiega sul predefinito (o su "Tutta l'Italia") senza schermate rotte.
8. **Mobile a 375px** (DevTools) → il chip sta su una riga sua, il tap target arriva a 44px, e il pannello è un Drawer dal basso che si apre **una volta sola** (non due).
9. **Tastiera** → Tab fino al chip, Invio apre, frecce/Tab attraversano le voci, Esc chiude e il focus torna al chip.
10. **`/addresses` → nuovo indirizzo** → i suggerimenti restano ordinati per vicinanza usando il GPS se concesso, altrimenti l'indirizzo attivo nel chip.

- [ ] **Step 4: PR**

```bash
git push -u origin feat/customer-search-origin
```

Poi apri la PR con titolo `feat(customer): origine della ricerca nel chip`, corpo che riassume: provider unico, chip in header (Popover/Drawer), `near` in URL senza coordinate, raggio sganciato dal permesso GPS, `useBiasPosition` rimosso. Linka la spec e le PR #175/#176/#177.

---

## Note di revisione (self-review sulla spec)

Copertura della sezione 3 della spec, riga per riga:

| Requisito della spec | Dove |
|---|---|
| provider condiviso in `features/location/`, montato in `_authenticated` | Task 3 |
| `origin: gps \| address \| none` | Task 2 (`SearchOrigin`) |
| `useGeolocation` come dettaglio interno | Task 1 + Task 3 (unico chiamante) |
| persistenza `{kind, addressId}` in try/catch, mai le coordinate | Task 2 (`STORAGE_KEY`, `serializeChoice`) + Task 3 (`commit`) |
| all'avvio: ultima scelta → `isDefault` → `none`, senza prompt | Task 2 (`bootChoice`) + Task 3 (effetto di boot) |
| chip in `site-header.tsx` con `MapPin` + etichetta | Task 4 |
| Popover desktop / Drawer mobile | Task 4 |
| voci: posizione attuale (permesso al tocco), indirizzi, "Tutta l'Italia", "Gestisci indirizzi" | Task 4 (`OriginOptions`) |
| `near=gps` / `near=<addressId>`, assente = eredita, nessuna coordinata | Task 6 |
| id non risolvibile → nessuna origine, senza errori | Task 3 (`adoptNear` → `false`, senza toccare la scelta salvata) + Task 6 (ripulitura dell'URL) |
| i 4 hook ricevono `coords` dal provider | Task 5 (`use-nearby-products`) + Task 6 (`use-store-search`, `use-store-facets`, `use-store-map`) |
| `radiusApplies` da `geoStatus === "granted"` a `coords !== null` | Task 6 |
| home senza bottone proprio, con invito "Scegli da dove cercare" che apre il chip | Task 5 |
| indirizzo cancellato mentre è l'origine attiva | Task 2 (test) + Task 3 (`originFromChoice` a ogni render) |
| bias del geocoder: GPS se concesso → origine-indirizzo → niente | Task 7 |

Fuori scope, di proposito: il checkout, il geocoding dei negozi del seller, la bottom tab bar mobile.
