# Rubrica indirizzi nel customer (PR 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare al cliente una rubrica dei propri indirizzi: una pagina `/addresses` dove cercarli per digitazione, correggerne la posizione su una mappa, e gestirli (crea, modifica, elimina, predefinito).

**Architecture:** la logica del form vive in un modulo **puro** e testato (`address-form-state.ts`); i dati passano da hook TanStack Query sottili che parlano con l'API via Eden Treaty (nessun DTO scritto a mano); la ricerca indirizzo è un `Combobox` alimentato da `GET /locations/geocode` (già in produzione dalla PR 1) con i risultati **nell'ordine in cui arrivano dal server**, perché quell'ordine è il bias di prossimità; la mappa è Leaflet montato solo client-side con un pin trascinabile.

**Tech Stack:** TanStack Start + Router + Query, Eden Treaty, `@bibs/ui` (Combobox, Dialog, Field, Switch, AlertDialog), react-leaflet 5, Paraglide, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-18-customer-address-book-design.md` (sezione 2)

Questo piano copre **solo la PR 2**. Il chip globale "cerca vicino a" e il wiring dei quattro hook geografici sono la PR 3 e avranno il proprio piano.

## Global Constraints

- **Formattazione:** Biome, **tab** per l'indentazione, **doppi apici** in JS/TS. Lefthook formatta in pre-commit; non aggirarlo (mai `--no-verify`).
- **File e directory:** kebab-case.
- **Copy:** mai testo utente hardcoded nei componenti. Tutto via Paraglide (`m.chiave()`), con le chiavi aggiunte **sia** a `apps/customer/messages/it.json` **sia** a `en.json`.
- **Tipi dall'API:** i tipi dei dati si derivano dalle risposte Eden (`Awaited<ReturnType<typeof fetch…>>`), non si scrivono a mano e non si importano dai sorgenti dell'API.
- **Errori:** le chiamate passano da `unwrap(res, fallback)` di `@bibs/ui/lib/api-client`, che propaga il messaggio del server quando c'è.
- **UI:** primitive da `@bibs/ui`, mai Radix nudo né copie di shadcn. Nel customer l'accento è il **saffron**; `EmptyState` di `@bibs/ui` usa il cobalto di seller/admin, quindi **non si usa qui** (vedi Task 6).
- **React Compiler:** `"use no memo"` serve **solo** a chi possiede o consuma lo state di TanStack Table. Qui non c'è nessuna tabella: non aggiungerlo.
- **Leaflet è DOM-only:** ogni componente che lo importa va caricato con `lazy()` e montato solo dopo l'hydration, mai importato staticamente in una route SSR.
- **Date da Eden:** Eden converte le stringhe-data in `Date`. Non renderizzare mai un campo data direttamente; in questa PR non serve mostrarne nessuno.
- **Commit:** Conventional Commits, descrizione in minuscolo e imperativa, scope `customer`. Un commit per task.
- **Verifica:** `bun run typecheck` dal root (propaga ai 3 frontend via Eden), `bun run lint`, `bun run test`, e `bun run --filter @bibs/customer build` come gate SSR.
- Branch di lavoro: `feat/customer-address-book`, aperto da `main` aggiornato (contiene già la PR 1 mergiata, squash `39c1cc2`).

## Struttura dei file

| File | Responsabilità |
|---|---|
| `apps/customer/src/features/addresses/address-form-state.ts` | **puro**: forma dei valori del form, conversioni da suggerimento e da indirizzo esistente, validazione, costruzione del body API |
| `apps/customer/src/features/addresses/address-form-state.test.ts` | test del modulo puro |
| `apps/customer/src/features/addresses/use-addresses.ts` | query della lista + tipi derivati da Eden |
| `apps/customer/src/features/addresses/use-municipalities.ts` | elenco comuni precaricato (per il fallback sul comune) |
| `apps/customer/src/features/addresses/use-address-mutations.ts` | crea / aggiorna / elimina / imposta predefinito |
| `apps/customer/src/features/addresses/use-geocode.ts` | suggerimenti dal geocoder + posizione per il bias |
| `apps/customer/src/features/addresses/address-search.tsx` | il campo di ricerca con autocomplete |
| `apps/customer/src/features/addresses/address-map-preview.tsx` | mappa client-only col pin trascinabile (export default, caricata con `lazy`) |
| `apps/customer/src/features/addresses/address-form-dialog.tsx` | il dialog che assembla ricerca, mappa e campi |
| `apps/customer/src/features/addresses/address-card.tsx` | una scheda indirizzo con le sue azioni |
| `apps/customer/src/routes/_authenticated/addresses.tsx` | la pagina |

---

### Task 1: Lo stato del form come funzioni pure

**Files:**
- Create: `apps/customer/src/features/addresses/address-form-state.ts`
- Test: `apps/customer/src/features/addresses/address-form-state.test.ts`
- Modify: `package.json` (script `test` al root)

**Interfaces:**
- Consumes: niente.
- Produces: `AddressFormValues`, `AddressFormErrors`, `MunicipalityOption`, `SuggestionLike`, `AddressLike`, `emptyAddressForm()`, `suggestionToAddressForm(suggestion, previous)`, `addressToAddressForm(address)`, `validateAddressForm(values)`, `isAddressFormValid(errors)`, `addressFormToBody(values)`.

Perché puro e separato: è l'unica logica di questa PR che si può testare senza un browser, ed è quella che sbaglia più facilmente (un suggerimento che cancella l'etichetta già digitata, un CAP non validato, un `municipalityId` nullo che arriva all'API).

I tipi in ingresso sono **strutturali** e non importati da altri moduli: così questo file non dipende da nessuno, e i tipi Eden delle task successive lo soddisfano per forma.

- [ ] **Step 1: Scrivi il test che falisce**

`apps/customer/src/features/addresses/address-form-state.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	addressFormToBody,
	addressToAddressForm,
	emptyAddressForm,
	isAddressFormValid,
	suggestionToAddressForm,
	validateAddressForm,
} from "./address-form-state";

const MILANO = { id: "m-mi", name: "Milano", provinceAcronym: "MI" };

const SUGGESTION = {
	addressLine1: "Via Roma 12",
	zipCode: "20096",
	location: { x: 9.327, y: 45.499 },
	municipality: MILANO,
	municipalityCandidates: [],
};

describe("emptyAddressForm", () => {
	it("starts with no municipality and no position", () => {
		const form = emptyAddressForm();
		expect(form.municipalityId).toBeNull();
		expect(form.location).toBeNull();
		expect(form.isDefault).toBe(false);
	});
});

describe("suggestionToAddressForm", () => {
	it("fills address, zip, municipality and position in one go", () => {
		const form = suggestionToAddressForm(SUGGESTION, emptyAddressForm());

		expect(form.addressLine1).toBe("Via Roma 12");
		expect(form.zipCode).toBe("20096");
		expect(form.municipalityId).toBe("m-mi");
		expect(form.location).toEqual({ x: 9.327, y: 45.499 });
	});

	// Il caso che fa la differenza fra un form usabile e uno irritante: chi ha
	// già scritto "Casa" non deve vederselo cancellare scegliendo un indirizzo.
	it("keeps what the customer already typed", () => {
		const previous = {
			...emptyAddressForm(),
			label: "Casa",
			recipientName: "Mario Rossi",
			phone: "0212345",
			isDefault: true,
		};

		const form = suggestionToAddressForm(SUGGESTION, previous);

		expect(form.label).toBe("Casa");
		expect(form.recipientName).toBe("Mario Rossi");
		expect(form.phone).toBe("0212345");
		expect(form.isDefault).toBe(true);
	});

	it("leaves the zip empty when the geocoder has none", () => {
		const form = suggestionToAddressForm(
			{ ...SUGGESTION, zipCode: null },
			emptyAddressForm(),
		);
		expect(form.zipCode).toBe("");
	});

	// Comune non risolto: nessun id, e i candidati viaggiano col form perché è
	// la UI a dover chiedere quale dei due omonimi è quello giusto.
	it("carries the candidates when the municipality is ambiguous", () => {
		const candidates = [
			{ id: "m-castro-bg", name: "Castro", provinceAcronym: "BG" },
			{ id: "m-castro-le", name: "Castro", provinceAcronym: "LE" },
		];

		const form = suggestionToAddressForm(
			{ ...SUGGESTION, municipality: null, municipalityCandidates: candidates },
			emptyAddressForm(),
		);

		expect(form.municipalityId).toBeNull();
		expect(form.municipalityCandidates).toEqual(candidates);
	});
});

describe("addressToAddressForm", () => {
	it("maps a saved address into form values, nulls becoming empty strings", () => {
		const form = addressToAddressForm({
			label: null,
			recipientName: "Mario Rossi",
			phone: null,
			addressLine1: "Via Roma 12",
			addressLine2: "Scala B",
			zipCode: "20096",
			municipality: MILANO,
			location: { x: 9.327, y: 45.499 },
			isDefault: true,
		});

		expect(form.label).toBe("");
		expect(form.phone).toBe("");
		expect(form.recipientName).toBe("Mario Rossi");
		expect(form.addressLine2).toBe("Scala B");
		expect(form.municipalityId).toBe("m-mi");
		expect(form.isDefault).toBe(true);
	});
});

describe("validateAddressForm", () => {
	function validForm() {
		return suggestionToAddressForm(SUGGESTION, emptyAddressForm());
	}

	it("accepts a form filled from a suggestion", () => {
		const errors = validateAddressForm(validForm());
		expect(errors).toEqual({});
		expect(isAddressFormValid(errors)).toBe(true);
	});

	it("requires the street line", () => {
		const errors = validateAddressForm({ ...validForm(), addressLine1: "   " });
		expect(errors.addressLine1).toBe("required");
		expect(isAddressFormValid(errors)).toBe(false);
	});

	it("requires the municipality", () => {
		const errors = validateAddressForm({ ...validForm(), municipalityId: null });
		expect(errors.municipalityId).toBe("required");
	});

	it("requires a position", () => {
		const errors = validateAddressForm({ ...validForm(), location: null });
		expect(errors.location).toBe("required");
	});

	it("requires the zip", () => {
		const errors = validateAddressForm({ ...validForm(), zipCode: "" });
		expect(errors.zipCode).toBe("required");
	});

	// Cinque cifre: è il pattern che l'API impone, non una nostra preferenza.
	it("rejects a zip that is not five digits", () => {
		expect(validateAddressForm({ ...validForm(), zipCode: "2009" }).zipCode).toBe(
			"format",
		);
		expect(
			validateAddressForm({ ...validForm(), zipCode: "2O096" }).zipCode,
		).toBe("format");
	});
});

describe("addressFormToBody", () => {
	it("trims the values and sends the position", () => {
		const body = addressFormToBody({
			...suggestionToAddressForm(SUGGESTION, emptyAddressForm()),
			label: "  Casa  ",
			addressLine2: " Scala B ",
		});

		expect(body.label).toBe("Casa");
		expect(body.addressLine1).toBe("Via Roma 12");
		expect(body.addressLine2).toBe("Scala B");
		expect(body.municipalityId).toBe("m-mi");
		expect(body.zipCode).toBe("20096");
		expect(body.location).toEqual({ x: 9.327, y: 45.499 });
		expect(body.isDefault).toBe(false);
	});

	// `phone` ha un minimo di 5 caratteri lato API: mandarlo vuoto sarebbe un
	// 422, quindi quando è vuoto non lo si manda affatto.
	it("omits an empty phone but keeps a cleared label", () => {
		const body = addressFormToBody({
			...suggestionToAddressForm(SUGGESTION, emptyAddressForm()),
			label: "",
			phone: "   ",
		});

		expect(body).not.toHaveProperty("phone");
		expect(body.label).toBe("");
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che falisca**

Run: `cd apps/customer && bun test src/features/addresses/address-form-state.test.ts`
Expected: FAIL — `Cannot find module './address-form-state'`.

- [ ] **Step 3: Implementa**

`apps/customer/src/features/addresses/address-form-state.ts`:

```ts
/**
 * Stato del form indirizzo, come funzioni pure. Nessun import: i tipi in
 * ingresso sono strutturali, così i tipi Eden delle query li soddisfano per
 * forma senza che questo file dipenda da loro.
 */

export interface MunicipalityOption {
	id: string;
	name: string;
	provinceAcronym: string;
}

/** La parte di un suggerimento del geocoder che riempie il form. */
export interface SuggestionLike {
	addressLine1: string;
	zipCode: string | null;
	location: { x: number; y: number };
	municipality: MunicipalityOption | null;
	municipalityCandidates: MunicipalityOption[];
}

/** La parte di un indirizzo salvato che riempie il form in modifica. */
export interface AddressLike {
	label: string | null;
	recipientName: string | null;
	phone: string | null;
	addressLine1: string;
	addressLine2: string | null;
	zipCode: string;
	municipality: MunicipalityOption;
	location: { x: number; y: number } | null;
	isDefault: boolean;
}

export interface AddressFormValues {
	label: string;
	recipientName: string;
	phone: string;
	addressLine1: string;
	addressLine2: string;
	zipCode: string;
	municipalityId: string | null;
	location: { x: number; y: number } | null;
	isDefault: boolean;
	/** Omonimi da far scegliere al cliente quando il geocoder non ha deciso. */
	municipalityCandidates: MunicipalityOption[];
}

/**
 * Codici, non testo: la copia vive in Paraglide, e questo modulo resta
 * testabile senza tirarsi dietro le traduzioni.
 */
export interface AddressFormErrors {
	addressLine1?: "required";
	zipCode?: "required" | "format";
	municipalityId?: "required";
	location?: "required";
}

const ZIP_PATTERN = /^\d{5}$/;

export function emptyAddressForm(): AddressFormValues {
	return {
		label: "",
		recipientName: "",
		phone: "",
		addressLine1: "",
		addressLine2: "",
		zipCode: "",
		municipalityId: null,
		location: null,
		isDefault: false,
		municipalityCandidates: [],
	};
}

/**
 * Applica un suggerimento ai soli campi dell'indirizzo, preservando quelli che
 * il cliente ha già compilato di suo (etichetta, destinatario, telefono,
 * predefinito).
 */
export function suggestionToAddressForm(
	suggestion: SuggestionLike,
	previous: AddressFormValues,
): AddressFormValues {
	return {
		...previous,
		addressLine1: suggestion.addressLine1,
		zipCode: suggestion.zipCode ?? "",
		municipalityId: suggestion.municipality?.id ?? null,
		municipalityCandidates: suggestion.municipalityCandidates,
		location: suggestion.location,
	};
}

export function addressToAddressForm(address: AddressLike): AddressFormValues {
	return {
		label: address.label ?? "",
		recipientName: address.recipientName ?? "",
		phone: address.phone ?? "",
		addressLine1: address.addressLine1,
		addressLine2: address.addressLine2 ?? "",
		zipCode: address.zipCode,
		municipalityId: address.municipality.id,
		location: address.location,
		isDefault: address.isDefault,
		municipalityCandidates: [],
	};
}

export function validateAddressForm(
	values: AddressFormValues,
): AddressFormErrors {
	const errors: AddressFormErrors = {};

	if (!values.addressLine1.trim()) errors.addressLine1 = "required";

	const zip = values.zipCode.trim();
	if (!zip) errors.zipCode = "required";
	else if (!ZIP_PATTERN.test(zip)) errors.zipCode = "format";

	if (!values.municipalityId) errors.municipalityId = "required";

	// Senza coordinate l'indirizzo non può essere origine di una ricerca, che è
	// metà del motivo per cui la rubrica esiste.
	if (!values.location) errors.location = "required";

	return errors;
}

export function isAddressFormValid(errors: AddressFormErrors): boolean {
	return Object.keys(errors).length === 0;
}

/**
 * Il body per `POST`/`PATCH /customer/addresses`. `phone` viene omesso quando è
 * vuoto perché l'API impone un minimo di 5 caratteri; etichetta e destinatario
 * vuoti vengono mandati, così cancellarli è possibile.
 */
export function addressFormToBody(values: AddressFormValues) {
	const phone = values.phone.trim();
	return {
		label: values.label.trim(),
		recipientName: values.recipientName.trim(),
		...(phone ? { phone } : {}),
		addressLine1: values.addressLine1.trim(),
		addressLine2: values.addressLine2.trim(),
		municipalityId: values.municipalityId as string,
		zipCode: values.zipCode.trim(),
		...(values.location ? { location: values.location } : {}),
		isDefault: values.isDefault,
	};
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `cd apps/customer && bun test src/features/addresses/address-form-state.test.ts`
Expected: PASS, 14 test.

- [ ] **Step 5: Aggancia la suite del customer alla verifica di root**

Oggi `bun run test` al root copre solo `@bibs/emails` e `@bibs/api`, quindi un test nel customer **non girerebbe in CI**. La suite customer esistente è verde (6 test), quindi agganciarla è sicuro.

In `package.json` al root, sostituisci lo script `test`:

```json
"test": "bun run --filter @bibs/emails test && bun run --filter @bibs/api test && bun run --filter @bibs/customer test",
```

Le tre invocazioni restano concatenate con `&&` e mai aggregate con `--filter '*'`: un filtro aggregato può nascondere il fallimento di un singolo workspace.

- [ ] **Step 6: Verifica che il root veda i test nuovi**

Run: `cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter @bibs/customer test`
Expected: PASS, 20 test (6 preesistenti + 14 nuovi).

- [ ] **Step 7: Commit**

```bash
git add apps/customer/src/features/addresses/address-form-state.ts apps/customer/src/features/addresses/address-form-state.test.ts package.json
git commit -m "feat(customer): add pure form state for the address book"
```

---

### Task 2: Gli hook dei dati

**Files:**
- Create: `apps/customer/src/features/addresses/use-addresses.ts`
- Create: `apps/customer/src/features/addresses/use-municipalities.ts`
- Create: `apps/customer/src/features/addresses/use-address-mutations.ts`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `addressFormToBody` (Task 1) per il tipo del body.
- Produces: `ADDRESSES_KEY`, `useAddresses()`, `AddressItem` (tipo derivato da Eden), `useMunicipalities()`, `useAddressMutations()` che restituisce `{ create, update, remove }` (mutation di TanStack Query).

Nota di perimetro: **nessuna mutation dedicata per "imposta predefinito"**. La spec mette quell'interruttore dentro il form, quindi si cambia il predefinito modificando l'indirizzo, e il vincolo di unicità è già garantito dal DB. Un'azione a un tocco sulla scheda sarebbe comoda, ma non è in questa PR.

- [ ] **Step 1: Aggiungi le chiavi di copy usate dagli hook**

In `apps/customer/messages/it.json`:

```json
	"addresses_load_failed": "Non riesco a caricare i tuoi indirizzi",
	"addresses_saved": "Indirizzo salvato",
	"addresses_deleted": "Indirizzo eliminato",
```

In `apps/customer/messages/en.json`, le stesse chiavi:

```json
	"addresses_load_failed": "Can't load your addresses",
	"addresses_saved": "Address saved",
	"addresses_deleted": "Address deleted",
```

- [ ] **Step 2: Scrivi la query della lista**

`apps/customer/src/features/addresses/use-addresses.ts`:

```ts
import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const ADDRESSES_KEY = ["customer", "addresses"] as const;

// Una rubrica personale non arriva a 50 voci: una pagina sola, e il cap
// dell'API è comunque 100.
async function fetchAddresses() {
	const res = await api().customer.addresses.get({ query: { limit: 50 } });
	return unwrap(res, m.addresses_load_failed()).data;
}

// I tipi vengono dall'API via Eden: nessun DTO scritto a mano da tenere in sync.
export type AddressItem = Awaited<ReturnType<typeof fetchAddresses>>[number];

export function useAddresses() {
	return useQuery({
		queryKey: ADDRESSES_KEY,
		staleTime: 60_000,
		queryFn: fetchAddresses,
	});
}
```

- [ ] **Step 3: Scrivi l'elenco dei comuni**

`apps/customer/src/features/addresses/use-municipalities.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Elenco completo dei comuni italiani, servito dall'API con cache HTTP di 24h e
 * immutabile: `staleTime: Infinity`. Serve al fallback sul comune quando il
 * geocoder non lo risolve.
 *
 * È il gemello dell'hook del seller (`apps/seller/src/hooks/use-municipalities.ts`):
 * duplicato di proposito, perché i register non condividono codice applicativo.
 */
export function useMunicipalities() {
	return useQuery({
		queryKey: ["municipalities", "all"] as const,
		queryFn: async () => {
			const res = await api().locations.municipalities.all.get();
			if (res.error) throw res.error;
			return res.data.data;
		},
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});
}
```

- [ ] **Step 4: Scrivi le mutazioni**

`apps/customer/src/features/addresses/use-address-mutations.ts`:

```ts
import { toast } from "@bibs/ui/components/sonner";
import { unwrap } from "@bibs/ui/lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";
import type { addressFormToBody } from "./address-form-state";
import { ADDRESSES_KEY } from "./use-addresses";

type AddressBody = ReturnType<typeof addressFormToBody>;

/**
 * Tutte le scritture sulla rubrica. Dopo ognuna si invalida la lista e si
 * rilegge: nessuno stato locale che duplichi il server.
 */
export function useAddressMutations() {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY });

	const create = useMutation({
		mutationFn: async (body: AddressBody) => {
			const res = await api().customer.addresses.post(body);
			return unwrap(res, m.error_generic()).data;
		},
		onSuccess: () => {
			void invalidate();
			toast.success(m.addresses_saved());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const update = useMutation({
		mutationFn: async (vars: { addressId: string; body: AddressBody }) => {
			const res = await api()
				.customer.addresses({ addressId: vars.addressId })
				.patch(vars.body);
			return unwrap(res, m.error_generic()).data;
		},
		onSuccess: () => {
			void invalidate();
			toast.success(m.addresses_saved());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const remove = useMutation({
		mutationFn: async (addressId: string) => {
			const res = await api().customer.addresses({ addressId }).delete();
			return unwrap(res, m.error_generic());
		},
		onSuccess: () => {
			void invalidate();
			toast.success(m.addresses_deleted());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return { create, update, remove };
}
```

- [ ] **Step 5: Verifica**

Run: `cd apps/customer && bun run typecheck`
Expected: nessun errore. Se Eden si lamenta della forma di un body o di un path, **non aggirare il tipo con un cast**: la forma giusta è quella che l'API espone, e il messaggio del compilatore la nomina.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/src/features/addresses/use-addresses.ts apps/customer/src/features/addresses/use-municipalities.ts apps/customer/src/features/addresses/use-address-mutations.ts apps/customer/messages/it.json apps/customer/messages/en.json
git commit -m "feat(customer): add address book data hooks"
```

---

### Task 3: La ricerca indirizzo con autocomplete

**Files:**
- Create: `apps/customer/src/features/addresses/use-geocode.ts`
- Create: `apps/customer/src/features/addresses/address-search.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `SuggestionLike` (Task 1).
- Produces: `useGeocode(text, near)`, `useBiasPosition()`, `GeocodeSuggestionItem` (tipo derivato da Eden), e il componente `AddressSearch({ onSelect, disabled })`.

Due cose da non sbagliare, entrambe sostanziali:

1. **L'ordine dei risultati arriva dal server e non va toccato.** Quell'ordine *è* il bias di prossimità: i risultati vicini vengono primi. Il `Combobox` va quindi usato con `filter={null}`, come fa `MunicipalityCombobox`, e i suggerimenti vanno resi nell'ordine ricevuto. Ordinare o filtrare lato client distruggerebbe il lavoro dell'endpoint.
2. **Il permesso di geolocalizzazione non si chiede da soli.** Si legge lo stato con `navigator.permissions.query({ name: "geolocation" })` dentro un `try/catch` (il supporto Safari è irregolare) e si prende la posizione **solo** se è già `granted`. Altrimenti si mostra un invito che la chiede al tocco.

- [ ] **Step 1: Aggiungi le chiavi di copy**

In `apps/customer/messages/it.json`:

```json
	"address_search_label": "Cerca l'indirizzo",
	"address_search_placeholder": "Via e civico, poi il comune",
	"address_search_hint": "Scrivi almeno 3 caratteri",
	"address_search_empty": "Nessun indirizzo trovato. Puoi inserirlo a mano qui sotto.",
	"address_search_unavailable": "Ricerca indirizzi non disponibile: inseriscilo a mano qui sotto.",
	"address_search_use_location": "Usa la mia posizione per vedere prima gli indirizzi vicini",
	"address_search_locating": "Cerco la posizione…",
	"address_geocode_failed": "Ricerca indirizzi non riuscita",
```

In `apps/customer/messages/en.json`:

```json
	"address_search_label": "Search the address",
	"address_search_placeholder": "Street and number, then the town",
	"address_search_hint": "Type at least 3 characters",
	"address_search_empty": "No address found. You can enter it by hand below.",
	"address_search_unavailable": "Address search is unavailable: enter it by hand below.",
	"address_search_use_location": "Use my location to see nearby addresses first",
	"address_search_locating": "Finding your location…",
	"address_geocode_failed": "Address search failed",
```

- [ ] **Step 2: Scrivi l'hook**

`apps/customer/src/features/addresses/use-geocode.ts`:

```ts
import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export interface BiasPosition {
	lat: number;
	lng: number;
}

async function fetchSuggestions(q: string, near: BiasPosition | null) {
	const res = await api().locations.geocode.get({
		query: {
			q,
			...(near ? { lat: near.lat, lng: near.lng } : {}),
		},
	});
	return unwrap(res, m.address_geocode_failed()).data;
}

export type GeocodeSuggestionItem = Awaited<
	ReturnType<typeof fetchSuggestions>
>[number];

/** Sotto i 3 caratteri l'endpoint risponde 400: non lo si chiama affatto. */
const MIN_QUERY = 3;

export function useGeocode(text: string, near: BiasPosition | null) {
	const q = text.trim();
	return useQuery({
		queryKey: ["geocode", q, near?.lat ?? null, near?.lng ?? null] as const,
		enabled: q.length >= MIN_QUERY,
		staleTime: 5 * 60_000,
		// Un 503 del provider non si ritenta da soli: la UI offre l'inserimento
		// a mano, e ritentare in loop peserebbe su un servizio già in difficoltà.
		retry: false,
		queryFn: () => fetchSuggestions(q, near),
	});
}

export type BiasStatus = "unknown" | "unavailable" | "prompt" | "pending" | "granted";

/**
 * La posizione usata per ordinare i suggerimenti per vicinanza. Non fa scattare
 * il prompt dei permessi da sola: se il consenso c'è già, prende la posizione in
 * silenzio; altrimenti resta in `prompt` e tocca alla UI offrire il bottone.
 *
 * La PR 3 sostituirà questo hook con l'origine condivisa del chip globale.
 */
export function useBiasPosition() {
	const [position, setPosition] = useState<BiasPosition | null>(null);
	const [status, setStatus] = useState<BiasStatus>("unknown");

	const read = useCallback(() => {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			setStatus("unavailable");
			return;
		}
		setStatus("pending");
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
				setStatus("granted");
			},
			() => setStatus("prompt"),
			{ enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
		);
	}, []);

	useEffect(() => {
		let cancelled = false;
		async function detect() {
			if (typeof navigator === "undefined" || !navigator.geolocation) {
				setStatus("unavailable");
				return;
			}
			try {
				const result = await navigator.permissions.query({
					name: "geolocation" as PermissionName,
				});
				if (cancelled) return;
				if (result.state === "granted") read();
				else setStatus("prompt");
			} catch {
				// Permissions API assente o senza supporto per `geolocation`: non
				// indoviniamo, lasciamo decidere al cliente.
				if (!cancelled) setStatus("prompt");
			}
		}
		void detect();
		return () => {
			cancelled = true;
		};
	}, [read]);

	return { position, status, request: read };
}
```

- [ ] **Step 3: Scrivi il componente**

`apps/customer/src/features/addresses/address-search.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@bibs/ui/components/combobox";
import { Field, FieldLabel } from "@bibs/ui/components/field";
import { LocateFixed, MapPin } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { m } from "@/paraglide/messages";
import type { GeocodeSuggestionItem } from "./use-geocode";
import { useBiasPosition, useGeocode } from "./use-geocode";

interface AddressSearchProps {
	onSelect: (suggestion: GeocodeSuggestionItem) => void;
	disabled?: boolean;
}

/**
 * Il campo che riempie il form. I suggerimenti restano **nell'ordine in cui
 * arrivano dal server**: quell'ordine è il bias di prossimità, e riordinarli
 * lato client vanificherebbe l'endpoint. Da qui `filter={null}`.
 */
export function AddressSearch({ onSelect, disabled }: AddressSearchProps) {
	const fieldId = useId();
	const [text, setText] = useState("");
	const [debounced, setDebounced] = useState("");
	const bias = useBiasPosition();

	// Una richiesta per pausa di digitazione, non una per tasto.
	useEffect(() => {
		const id = setTimeout(() => setDebounced(text), 300);
		return () => clearTimeout(id);
	}, [text]);

	const { data, isFetching, isError } = useGeocode(debounced, bias.position);
	const suggestions = data ?? [];

	return (
		<Field>
			<FieldLabel htmlFor={fieldId}>{m.address_search_label()}</FieldLabel>
			<Combobox
				items={suggestions}
				filter={null}
				itemToStringLabel={(item: GeocodeSuggestionItem) => item.label}
				itemToStringValue={(item: GeocodeSuggestionItem) => item.providerRef}
				isItemEqualToValue={(
					a: GeocodeSuggestionItem,
					b: GeocodeSuggestionItem,
				) => a.providerRef === b.providerRef}
				value={null}
				onValueChange={(item: GeocodeSuggestionItem | null) => {
					if (item) onSelect(item);
				}}
				onInputValueChange={(next: string) => setText(next)}
			>
				<ComboboxInput
					id={fieldId}
					placeholder={m.address_search_placeholder()}
					disabled={disabled}
					showTrigger={false}
				/>
				<ComboboxContent>
					<ComboboxList>
						{suggestions.map((item) => (
							<ComboboxItem key={item.providerRef} value={item}>
								<MapPin
									className="mr-2 size-4 shrink-0 text-muted-foreground"
									aria-hidden
								/>
								{item.label}
							</ComboboxItem>
						))}
					</ComboboxList>
					<ComboboxEmpty>
						{isError
							? m.address_search_unavailable()
							: debounced.trim().length < 3
								? m.address_search_hint()
								: isFetching
									? m.address_search_locating()
									: m.address_search_empty()}
					</ComboboxEmpty>
				</ComboboxContent>
			</Combobox>

			{bias.status === "prompt" && (
				<Button
					type="button"
					variant="secondary"
					size="sm"
					className="mt-1 min-h-11 self-start sm:min-h-9"
					onClick={bias.request}
				>
					<LocateFixed className="size-4" aria-hidden />
					{m.address_search_use_location()}
				</Button>
			)}
			{bias.status === "granted" && (
				<p className="mt-1 text-muted-foreground text-xs">
					{m.address_search_nearby_first()}
				</p>
			)}
		</Field>
	);
}
```

- [ ] **Step 4: Aggiungi la chiave usata dallo stato `granted`**

In `apps/customer/messages/it.json`:

```json
	"address_search_nearby_first": "Prima gli indirizzi vicini a te",
```

In `apps/customer/messages/en.json`:

```json
	"address_search_nearby_first": "Nearby addresses first",
```

- [ ] **Step 5: Verifica**

Run: `cd apps/customer && bun run typecheck`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/src/features/addresses/use-geocode.ts apps/customer/src/features/addresses/address-search.tsx apps/customer/messages/it.json apps/customer/messages/en.json
git commit -m "feat(customer): add address autocomplete backed by the geocoder"
```

---

### Task 4: La mappa col pin trascinabile

**Files:**
- Create: `apps/customer/src/features/addresses/address-map-preview.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `pinIcon` e `KeepSizeInSync` da `@/features/stores/map-shared`.
- Produces: `AddressMapPreview` come **export default** (serve a `lazy()`), con props `{ location: { x: number; y: number }; onMove: (location: { x: number; y: number }) => void }`.

Perché il pin è trascinabile: il geocoder sbaglia i civici, e il cliente è l'unico che sa dov'è il proprio portone. Perché `export default`: il componente importa Leaflet, che è DOM-only, quindi il chiamante lo carica con `lazy()` e lo monta solo dopo l'hydration — un import statico in una route SSR fa `window is not defined`.

- [ ] **Step 1: Aggiungi la chiave di copy**

In `apps/customer/messages/it.json`:

```json
	"address_map_hint": "Trascina il pin se la posizione non è esatta",
```

In `apps/customer/messages/en.json`:

```json
	"address_map_hint": "Drag the pin if the position isn't exact",
```

- [ ] **Step 2: Implementa**

`apps/customer/src/features/addresses/address-map-preview.tsx`:

```tsx
import "leaflet/dist/leaflet.css";
import type { Marker as LeafletMarker } from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { KeepSizeInSync, pinIcon } from "@/features/stores/map-shared";

interface AddressMapPreviewProps {
	/** PostGIS point: `x` è la longitudine, `y` la latitudine. */
	location: { x: number; y: number };
	onMove: (location: { x: number; y: number }) => void;
}

/**
 * Ricentra la mappa quando il form riceve una posizione nuova (per esempio
 * scegliendo un suggerimento): `MapContainer` legge `center` solo al mount.
 */
function RecenterOn({ lat, lng }: { lat: number; lng: number }) {
	const map = useMap();
	useEffect(() => {
		map.setView([lat, lng], map.getZoom());
	}, [map, lat, lng]);
	return null;
}

export default function AddressMapPreview({
	location,
	onMove,
}: AddressMapPreviewProps) {
	return (
		<MapContainer
			center={[location.y, location.x]}
			zoom={17}
			scrollWheelZoom={false}
			className="h-48 w-full rounded-lg sm:h-56"
			style={{ zIndex: 0 }}
		>
			<TileLayer
				attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
			/>
			<Marker
				draggable
				position={[location.y, location.x]}
				icon={pinIcon}
				eventHandlers={{
					dragend: (event) => {
						const { lat, lng } = (event.target as LeafletMarker).getLatLng();
						onMove({ x: lng, y: lat });
					},
				}}
			/>
			<RecenterOn lat={location.y} lng={location.x} />
			<KeepSizeInSync />
		</MapContainer>
	);
}
```

- [ ] **Step 3: Verifica tipi e build**

```bash
cd apps/customer && bun run typecheck
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter @bibs/customer build
```

Expected: entrambi a 0. La build è il gate che conta per Leaflet: se il componente finisse importato staticamente da una route, la build SSR fallirebbe con `window is not defined`.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/features/addresses/address-map-preview.tsx apps/customer/messages/it.json apps/customer/messages/en.json
git commit -m "feat(customer): add a draggable pin preview for an address"
```

---

### Task 5: Il dialog del form

**Files:**
- Create: `apps/customer/src/features/addresses/address-form-dialog.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: tutto quanto prodotto dalle Task 1-4, più `useMunicipalities` (Task 2) e `MunicipalityCombobox` da `@bibs/ui/components/municipality-combobox`.
- Produces: `AddressFormDialog` con props `{ open: boolean; onOpenChange: (open: boolean) => void; address?: AddressItem }` — senza `address` è una creazione, con `address` una modifica.

L'ordine dei campi non è estetico, è il flusso d'uso: **prima la ricerca**, che riempie tutto; poi la mappa per correggere il punto; poi i campi, editabili, per i casi che il geocoder sbaglia; poi etichetta e dati di consegna.

- [ ] **Step 1: Aggiungi le chiavi di copy**

In `apps/customer/messages/it.json`:

```json
	"address_form_create_title": "Nuovo indirizzo",
	"address_form_edit_title": "Modifica indirizzo",
	"address_form_description": "Cerca l'indirizzo e controlla il punto sulla mappa.",
	"address_form_line1": "Indirizzo e civico",
	"address_form_line2": "Interno, scala, citofono",
	"address_form_zip": "CAP",
	"address_form_municipality": "Comune",
	"address_form_municipality_confirm": "Conferma il comune",
	"address_form_municipality_ambiguous": "Esistono più comuni con questo nome: controlla che sia quello giusto.",
	"address_form_label": "Etichetta",
	"address_form_label_placeholder": "Casa, Lavoro…",
	"address_form_label_home": "Casa",
	"address_form_label_work": "Lavoro",
	"address_form_label_other": "Altro",
	"address_form_recipient": "Destinatario",
	"address_form_phone": "Telefono",
	"address_form_delivery_note": "Serviranno per le consegne.",
	"address_form_default": "Usalo come indirizzo predefinito",
	"address_form_save": "Salva indirizzo",
	"address_form_cancel": "Annulla",
	"address_form_error_required": "Campo obbligatorio",
	"address_form_error_zip": "Il CAP è di 5 cifre",
	"address_form_error_location": "Scegli un indirizzo dalla ricerca o sposta il pin sulla mappa",
```

In `apps/customer/messages/en.json`:

```json
	"address_form_create_title": "New address",
	"address_form_edit_title": "Edit address",
	"address_form_description": "Search the address and check the spot on the map.",
	"address_form_line1": "Street and number",
	"address_form_line2": "Flat, floor, buzzer",
	"address_form_zip": "Postcode",
	"address_form_municipality": "Municipality",
	"address_form_municipality_confirm": "Confirm the municipality",
	"address_form_municipality_ambiguous": "More than one municipality has this name: check it's the right one.",
	"address_form_label": "Label",
	"address_form_label_placeholder": "Home, Work…",
	"address_form_label_home": "Home",
	"address_form_label_work": "Work",
	"address_form_label_other": "Other",
	"address_form_recipient": "Recipient",
	"address_form_phone": "Phone",
	"address_form_delivery_note": "These will be used for deliveries.",
	"address_form_default": "Use it as my default address",
	"address_form_save": "Save address",
	"address_form_cancel": "Cancel",
	"address_form_error_required": "Required field",
	"address_form_error_zip": "The postcode is 5 digits",
	"address_form_error_location": "Pick an address from the search, or move the pin on the map",
```

- [ ] **Step 2: Implementa**

`apps/customer/src/features/addresses/address-form-dialog.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { MunicipalityCombobox } from "@bibs/ui/components/municipality-combobox";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { Switch } from "@bibs/ui/components/switch";
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { m } from "@/paraglide/messages";
import type { AddressFormErrors, AddressFormValues } from "./address-form-state";
import {
	addressFormToBody,
	addressToAddressForm,
	emptyAddressForm,
	isAddressFormValid,
	suggestionToAddressForm,
	validateAddressForm,
} from "./address-form-state";
import { AddressSearch } from "./address-search";
import type { AddressItem } from "./use-addresses";
import { useAddressMutations } from "./use-address-mutations";
import { useMunicipalities } from "./use-municipalities";

// Leaflet è DOM-only: si carica a parte e si monta solo dopo l'hydration.
const LazyAddressMapPreview = lazy(() => import("./address-map-preview"));

const LABEL_PRESETS = ["label_home", "label_work", "label_other"] as const;

function errorText(code: AddressFormErrors[keyof AddressFormErrors]) {
	if (code === "format") return m.address_form_error_zip();
	return m.address_form_error_required();
}

interface AddressFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Assente = creazione; presente = modifica di quell'indirizzo. */
	address?: AddressItem;
}

export function AddressFormDialog({
	open,
	onOpenChange,
	address,
}: AddressFormDialogProps) {
	const ids = useId();
	const [values, setValues] = useState<AddressFormValues>(emptyAddressForm());
	const [touched, setTouched] = useState(false);
	const municipalities = useMunicipalities();
	const { create, update } = useAddressMutations();

	// Il dialog si rimonta a ogni apertura, quindi i valori si sincronizzano
	// sull'indirizzo in modifica senza il `reset(defaultValues)` di RHF che
	// desincronizza i Select.
	useEffect(() => {
		if (!open) return;
		setValues(address ? addressToAddressForm(address) : emptyAddressForm());
		setTouched(false);
	}, [open, address]);

	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);

	const errors = validateAddressForm(values);
	const showErrors = touched;
	const isSubmitting = create.isPending || update.isPending;

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setTouched(true);
		if (!isAddressFormValid(errors)) return;

		const body = addressFormToBody(values);
		const done = { onSuccess: () => onOpenChange(false) };
		if (address) update.mutate({ addressId: address.id, body }, done);
		else create.mutate(body, done);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{address
							? m.address_form_edit_title()
							: m.address_form_create_title()}
					</DialogTitle>
					<DialogDescription>{m.address_form_description()}</DialogDescription>
				</DialogHeader>

				<form className="space-y-5" onSubmit={handleSubmit}>
					<AddressSearch
						disabled={isSubmitting}
						onSelect={(suggestion) =>
							setValues((previous) =>
								suggestionToAddressForm(suggestion, previous),
							)
						}
					/>

					{values.location && (
						<div className="space-y-1.5">
							{hydrated ? (
								<Suspense
									fallback={<Skeleton className="h-48 w-full sm:h-56" />}
								>
									<LazyAddressMapPreview
										location={values.location}
										onMove={(location) =>
											setValues((previous) => ({ ...previous, location }))
										}
									/>
								</Suspense>
							) : (
								<Skeleton className="h-48 w-full sm:h-56" />
							)}
							<p className="text-muted-foreground text-xs">
								{m.address_map_hint()}
							</p>
						</div>
					)}

					<Field data-invalid={showErrors && !!errors.addressLine1}>
						<FieldLabel htmlFor={`${ids}-line1`}>
							{m.address_form_line1()}
						</FieldLabel>
						<Input
							id={`${ids}-line1`}
							value={values.addressLine1}
							onChange={(e) =>
								setValues((v) => ({ ...v, addressLine1: e.target.value }))
							}
							aria-invalid={showErrors && !!errors.addressLine1}
						/>
						{showErrors && errors.addressLine1 && (
							<FieldError>{errorText(errors.addressLine1)}</FieldError>
						)}
					</Field>

					<Field>
						<FieldLabel htmlFor={`${ids}-line2`}>
							{m.address_form_line2()}
						</FieldLabel>
						<Input
							id={`${ids}-line2`}
							value={values.addressLine2}
							onChange={(e) =>
								setValues((v) => ({ ...v, addressLine2: e.target.value }))
							}
						/>
					</Field>

					<div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
						<Field data-invalid={showErrors && !!errors.zipCode}>
							<FieldLabel htmlFor={`${ids}-zip`}>
								{m.address_form_zip()}
							</FieldLabel>
							<Input
								id={`${ids}-zip`}
								inputMode="numeric"
								maxLength={5}
								value={values.zipCode}
								onChange={(e) =>
									setValues((v) => ({ ...v, zipCode: e.target.value }))
								}
								aria-invalid={showErrors && !!errors.zipCode}
							/>
							{showErrors && errors.zipCode && (
								<FieldError>{errorText(errors.zipCode)}</FieldError>
							)}
						</Field>

						<Field data-invalid={showErrors && !!errors.municipalityId}>
							<FieldLabel htmlFor={`${ids}-municipality`}>
								{values.municipalityId
									? m.address_form_municipality()
									: m.address_form_municipality_confirm()}
							</FieldLabel>
							<MunicipalityCombobox
								id={`${ids}-municipality`}
								value={values.municipalityId}
								onChange={(id) =>
									setValues((v) => ({ ...v, municipalityId: id }))
								}
								municipalities={municipalities.data}
								loading={municipalities.isPending}
								error={municipalities.isError}
								aria-invalid={showErrors && !!errors.municipalityId}
							/>
							{values.municipalityCandidates.length > 1 && (
								<p className="text-muted-foreground text-xs">
									{m.address_form_municipality_ambiguous()}
								</p>
							)}
							{showErrors && errors.municipalityId && (
								<FieldError>{errorText(errors.municipalityId)}</FieldError>
							)}
						</Field>
					</div>

					{showErrors && errors.location && (
						<p className="text-destructive text-sm">
							{m.address_form_error_location()}
						</p>
					)}

					<Field>
						<FieldLabel htmlFor={`${ids}-label`}>
							{m.address_form_label()}
						</FieldLabel>
						<Input
							id={`${ids}-label`}
							placeholder={m.address_form_label_placeholder()}
							maxLength={50}
							value={values.label}
							onChange={(e) =>
								setValues((v) => ({ ...v, label: e.target.value }))
							}
						/>
						<div className="mt-1 flex flex-wrap gap-2">
							{LABEL_PRESETS.map((preset) => {
								const text =
									preset === "label_home"
										? m.address_form_label_home()
										: preset === "label_work"
											? m.address_form_label_work()
											: m.address_form_label_other();
								return (
									<Button
										key={preset}
										type="button"
										variant="secondary"
										size="sm"
										className="min-h-11 sm:min-h-8"
										onClick={() => setValues((v) => ({ ...v, label: text }))}
									>
										{text}
									</Button>
								);
							})}
						</div>
					</Field>

					<div className="grid gap-4 sm:grid-cols-2">
						<Field>
							<FieldLabel htmlFor={`${ids}-recipient`}>
								{m.address_form_recipient()}
							</FieldLabel>
							<Input
								id={`${ids}-recipient`}
								maxLength={100}
								value={values.recipientName}
								onChange={(e) =>
									setValues((v) => ({ ...v, recipientName: e.target.value }))
								}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${ids}-phone`}>
								{m.address_form_phone()}
							</FieldLabel>
							<Input
								id={`${ids}-phone`}
								type="tel"
								maxLength={30}
								value={values.phone}
								onChange={(e) =>
									setValues((v) => ({ ...v, phone: e.target.value }))
								}
							/>
						</Field>
					</div>
					<p className="text-muted-foreground text-xs">
						{m.address_form_delivery_note()}
					</p>

					<div className="flex items-center gap-3">
						<Switch
							id={`${ids}-default`}
							checked={values.isDefault}
							onCheckedChange={(checked) =>
								setValues((v) => ({ ...v, isDefault: checked }))
							}
						/>
						<FieldLabel htmlFor={`${ids}-default`}>
							{m.address_form_default()}
						</FieldLabel>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="secondary"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							{m.address_form_cancel()}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{m.address_form_save()}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
```

- [ ] **Step 3: Verifica**

```bash
cd apps/customer && bun run typecheck
```

Expected: nessun errore. Se `Switch` espone `onCheckedChange` con una firma diversa, allineala leggendo `packages/ui/src/components/switch.tsx` invece di forzare un cast. Stessa cosa per `data-invalid` su `Field`: se la prop non esiste, togli quell'attributo e lascia solo `aria-invalid` sull'input.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/features/addresses/address-form-dialog.tsx apps/customer/messages/it.json apps/customer/messages/en.json
git commit -m "feat(customer): add the address form dialog"
```

---

### Task 6: La pagina, la scheda indirizzo e il rimando dal profilo

**Files:**
- Create: `apps/customer/src/features/addresses/address-card.tsx`
- Create: `apps/customer/src/routes/_authenticated/addresses.tsx`
- Modify: `apps/customer/src/routes/_authenticated/profile.tsx`
- Modify: `apps/customer/src/routeTree.gen.ts` (generato, ma **tracciato**)
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `useAddresses`, `AddressItem` (Task 2), `useAddressMutations` (Task 2), `AddressFormDialog` (Task 5).
- Produces: la route `/addresses` e il componente `AddressCard`.

**Tre scostamenti dalla spec, dichiarati:**

1. La spec elenca fra le azioni della scheda anche *"Cerca qui vicino"*. È **rinviata alla PR 3**: quell'azione porterebbe a `/stores?near=<addressId>`, e il parametro `near` non esiste ancora. Un pulsante che non va da nessuna parte è peggio di un pulsante assente.
2. La spec prevedeva un `address-list.tsx`. La lista è dieci righe dentro la pagina, quindi vive lì, e il componente separato è la **scheda** (`address-card.tsx`), che di righe ne ha davvero.
3. **Niente `EmptyState` di `@bibs/ui`** (motivo qui sotto).

Poi:

- **Niente `EmptyState` di `@bibs/ui`**: quel componente usa `bg-cobalt-soft`/`text-cobalt-deep`, e il cobalto è l'accento di seller e admin. Nel customer lo stato vuoto si fa con `Notice` / `NoticePage` di `@/components/notice`, che è esattamente il componente nato per questo (lo usa già il carrello).
- **Il badge dice "Predefinito" al singolare**: è lo stato di una entità sola, non l'etichetta di un insieme.

- [ ] **Step 1: Aggiungi le chiavi di copy**

In `apps/customer/messages/it.json`:

```json
	"addresses_title": "I tuoi indirizzi",
	"addresses_subtitle": "Usali per cercare negozi e prodotti vicino a te, e per le consegne.",
	"addresses_add": "Aggiungi indirizzo",
	"addresses_edit": "Modifica",
	"addresses_delete": "Elimina",
	"addresses_default_badge": "Predefinito",
	"addresses_empty_title": "Nessun indirizzo salvato",
	"addresses_empty_description": "Salva gli indirizzi che usi più spesso: casa, lavoro, o quello di chi riceve i tuoi regali.",
	"addresses_error_title": "Non riesco a caricare i tuoi indirizzi",
	"addresses_error_description": "Riprova: se il problema resta, è dalla nostra parte.",
	"addresses_retry": "Riprova",
	"addresses_delete_title": "Eliminare questo indirizzo?",
	"addresses_delete_description": "Non comparirà più fra i tuoi indirizzi. Gli ordini già fatti non cambiano.",
	"addresses_delete_confirm": "Elimina indirizzo",
	"profile_addresses_link": "I tuoi indirizzi",
	"profile_addresses_description": "Gestisci gli indirizzi per la ricerca e per le consegne.",
```

In `apps/customer/messages/en.json`:

```json
	"addresses_title": "Your addresses",
	"addresses_subtitle": "Use them to search shops and products near you, and for deliveries.",
	"addresses_add": "Add address",
	"addresses_edit": "Edit",
	"addresses_delete": "Delete",
	"addresses_default_badge": "Default",
	"addresses_empty_title": "No saved address",
	"addresses_empty_description": "Save the addresses you use most: home, work, or the one you send gifts to.",
	"addresses_error_title": "Can't load your addresses",
	"addresses_error_description": "Try again: if it persists, it's on us.",
	"addresses_retry": "Try again",
	"addresses_delete_title": "Delete this address?",
	"addresses_delete_description": "It won't appear among your addresses any more. Existing orders don't change.",
	"addresses_delete_confirm": "Delete address",
	"profile_addresses_link": "Your addresses",
	"profile_addresses_description": "Manage the addresses for search and deliveries.",
```

- [ ] **Step 2: Scrivi la scheda**

`apps/customer/src/features/addresses/address-card.tsx`:

```tsx
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@bibs/ui/components/alert-dialog";
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { m } from "@/paraglide/messages";
import type { AddressItem } from "./use-addresses";

interface AddressCardProps {
	address: AddressItem;
	onEdit: () => void;
	onDelete: () => void;
	busy?: boolean;
}

export function AddressCard({
	address,
	onEdit,
	onDelete,
	busy,
}: AddressCardProps) {
	const title = address.label?.trim() || address.addressLine1;

	return (
		<li className="rounded-xl border border-border p-4">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h3 className="truncate font-display font-semibold text-foreground">
							{title}
						</h3>
						{address.isDefault && (
							<Badge variant="secondary">{m.addresses_default_badge()}</Badge>
						)}
					</div>
					<p className="mt-1 text-muted-foreground text-sm">
						{address.addressLine1}
						{address.addressLine2 ? `, ${address.addressLine2}` : ""}
					</p>
					<p className="text-muted-foreground text-sm">
						{address.zipCode} {address.municipality.name} (
						{address.municipality.provinceAcronym})
					</p>
					{(address.recipientName || address.phone) && (
						<p className="mt-1 text-muted-foreground text-xs">
							{[address.recipientName, address.phone]
								.filter(Boolean)
								.join(" · ")}
						</p>
					)}
				</div>
			</div>

			<div className="mt-3 flex flex-wrap gap-2">
				<Button
					variant="secondary"
					size="sm"
					className="min-h-11 sm:min-h-9"
					onClick={onEdit}
					disabled={busy}
				>
					{m.addresses_edit()}
				</Button>
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="min-h-11 text-destructive sm:min-h-9"
							disabled={busy}
						>
							{m.addresses_delete()}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{m.addresses_delete_title()}</AlertDialogTitle>
							<AlertDialogDescription>
								{m.addresses_delete_description()}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{m.address_form_cancel()}</AlertDialogCancel>
							<AlertDialogAction onClick={onDelete}>
								{m.addresses_delete_confirm()}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</li>
	);
}
```

- [ ] **Step 3: Scrivi la pagina**

`apps/customer/src/routes/_authenticated/addresses.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { MapPinPlus, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Notice } from "@/components/notice";
import { AddressCard } from "@/features/addresses/address-card";
import { AddressFormDialog } from "@/features/addresses/address-form-dialog";
import type { AddressItem } from "@/features/addresses/use-addresses";
import { useAddresses } from "@/features/addresses/use-addresses";
import { useAddressMutations } from "@/features/addresses/use-address-mutations";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/addresses")({
	component: AddressesPage,
});

function AddressesPage() {
	const { data: addresses, isPending, isError, refetch } = useAddresses();
	const { remove } = useAddressMutations();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<AddressItem | undefined>(undefined);

	const openCreate = () => {
		setEditing(undefined);
		setDialogOpen(true);
	};
	const openEdit = (address: AddressItem) => {
		setEditing(address);
		setDialogOpen(true);
	};

	return (
		<div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="space-y-1">
					<h1 className="font-bold font-display text-2xl text-primary tracking-[-0.015em]">
						{m.addresses_title()}
					</h1>
					<p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
						{m.addresses_subtitle()}
					</p>
				</div>
				<Button className="min-h-11" onClick={openCreate}>
					<Plus className="size-4" aria-hidden />
					{m.addresses_add()}
				</Button>
			</div>

			<div className="mt-8">
				{isPending ? (
					<div className="space-y-3" aria-hidden>
						<Skeleton className="h-32 w-full" />
						<Skeleton className="h-32 w-full" />
					</div>
				) : isError ? (
					<Notice
						icon={TriangleAlert}
						title={m.addresses_error_title()}
						description={m.addresses_error_description()}
						action={
							<Button variant="secondary" onClick={() => refetch()}>
								{m.addresses_retry()}
							</Button>
						}
					/>
				) : addresses && addresses.length > 0 ? (
					<ul className="space-y-3">
						{addresses.map((address) => (
							<AddressCard
								key={address.id}
								address={address}
								busy={remove.isPending}
								onEdit={() => openEdit(address)}
								onDelete={() => remove.mutate(address.id)}
							/>
						))}
					</ul>
				) : (
					<Notice
						icon={MapPinPlus}
						title={m.addresses_empty_title()}
						description={m.addresses_empty_description()}
						action={
							<Button onClick={openCreate}>
								<Plus className="size-4" aria-hidden />
								{m.addresses_add()}
							</Button>
						}
					/>
				)}
			</div>

			<AddressFormDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				address={editing}
			/>
		</div>
	);
}
```

- [ ] **Step 4: Aggiungi il rimando dal profilo**

In `apps/customer/src/routes/_authenticated/profile.tsx`, aggiungi l'import del `Link` e una scheda-rimando **dopo** `<PersonalInfoForm />`:

```tsx
import { Link } from "@tanstack/react-router";
import { ChevronRight, MapPin } from "lucide-react";
import { m } from "@/paraglide/messages";
```

e dentro il `div` della pagina, in coda:

```tsx
			<Link
				to="/addresses"
				className="mt-8 flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50"
			>
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<MapPin className="size-5" aria-hidden />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block font-display font-semibold text-foreground">
						{m.profile_addresses_link()}
					</span>
					<span className="block text-muted-foreground text-sm">
						{m.profile_addresses_description()}
					</span>
				</span>
				<ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
			</Link>
```

- [ ] **Step 5: Rigenera e committa l'albero delle route**

Il file `apps/customer/src/routeTree.gen.ts` è generato ma **tracciato da git**, e viene rigenerato dal dev server o dalla build, non da `tsc`. Se aggiungi la route e non lo committi, la CI typecheck va rossa mentre in locale è verde.

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter @bibs/customer build
git status --porcelain apps/customer/src/routeTree.gen.ts
```

Expected: il file risulta modificato e contiene `/_authenticated/addresses`.

- [ ] **Step 6: Verifica**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck && bun run lint
```

Expected: entrambi a 0.

- [ ] **Step 7: Commit**

```bash
git add apps/customer/src/features/addresses/address-card.tsx apps/customer/src/routes/_authenticated/addresses.tsx apps/customer/src/routes/_authenticated/profile.tsx apps/customer/src/routeTree.gen.ts apps/customer/messages/it.json apps/customer/messages/en.json
git commit -m "feat(customer): add the addresses page and profile entry point"
```

---

### Task 7: Verifica nel browser e PR

**Files:** nessuno da modificare, salvo le correzioni che la verifica rivela.

- [ ] **Step 1: Verifica completa dal root**

```bash
bun run typecheck
bun run lint
bun run test
bun run --filter @bibs/customer build
```

Expected: tutti e quattro a 0. La build è il gate SSR di Leaflet.

- [ ] **Step 2: Avvia il customer e accedi**

```bash
cd apps/customer && bun run dev
```

Poi apri `http://localhost:3001` e accedi con `customer1@test.com` / `password123`. L'API deve girare su `:3000` (`cd apps/api && bun run dev`) e l'infrastruttura locale essere su.

- [ ] **Step 3: Esercita i percorsi che contano**

Uno per uno, sulla pagina `/addresses`:

1. **Stato vuoto** → il riquadro con l'invito e il pulsante che apre il dialog.
2. **Ricerca con posizione negata**: apri il dialog, scrivi `via roma 12`. Devono arrivare suggerimenti, e comparire il bottone che offre di usare la posizione (non deve essere scattato alcun prompt all'apertura del dialog).
3. **Ricerca con posizione concessa**: concedi la posizione e riscrivi `via roma 12`. I suggerimenti devono essere di comuni vicini a te.
4. **Indirizzo lontano**: `via roma 12 palermo` deve restituire risultati in provincia di Palermo anche se la tua posizione è altrove.
5. **Selezione** → via, CAP, comune e mappa si riempiono in un colpo; il pin è trascinabile e spostandolo il salvataggio usa la posizione nuova.
6. **Etichetta preservata**: scrivi `Casa` nell'etichetta **prima** di scegliere un suggerimento, e verifica che scegliendolo non venga cancellata.
7. **Validazione**: svuota il CAP e prova a salvare → errore sul campo; metti `2009` → errore di formato.
8. **Salvataggio, modifica, predefinito, eliminazione** con conferma.
9. **Mobile**: a 390px di larghezza il dialog scrolla, la mappa si vede, e i pulsanti si toccano senza mirare.
10. **Rimando dal profilo**: `/profile` mostra la scheda che porta a `/addresses`.

Annota qualsiasi cosa non torni: **non** aggiustare la UI a occhio senza aver guardato lo screenshot o l'elemento reale.

- [ ] **Step 4: Apri la PR**

```bash
git push -u origin feat/customer-address-book
gh pr create --base main --title "feat(customer): rubrica indirizzi" --body "$(cat <<'BODY'
Seconda delle tre PR della rubrica indirizzi. Dipende dalla #175 (geocoding API), già mergiata.

Aggiunge `/addresses` nel customer: ricerca dell'indirizzo per digitazione con i risultati vicini per primi, mappa col pin trascinabile per correggere il punto, e gestione completa (crea, modifica, elimina, predefinito). Il rimando vive in `/profile`.

Il form nasce già completo di destinatario e telefono: quando arriverà il checkout troverà gli indirizzi pronti.

Spec: `docs/superpowers/specs/2026-09-18-customer-address-book-design.md` (sezione 2)
Piano: `docs/superpowers/plans/2026-09-18-customer-address-book-ui.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Note per chi esegue

- **Non toccare l'API.** Gli endpoint indirizzi e il geocoding sono già in produzione dalla #175. Se ti sembra che serva una modifica lato server, fermati e segnalalo: è più probabile che manchi un pezzo di contesto.
- **Non introdurre `react-hook-form`** in questa app: nel customer non è usato, e il suo `reset(defaultValues)` con riferimenti instabili desincronizza i Select. Lo stato controllato più `Field` è il pattern di questa app.
- **L'ordine dei suggerimenti non si tocca.** Arriva dal server e porta con sé il bias di prossimità.
- **Il chip globale non è questa PR.** Se ti viene la tentazione di mettere l'origine della ricerca nella top bar, quella è la PR 3.
