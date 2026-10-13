# Onboarding seller: verifica email e documento d'identità — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dopo il link di verifica email il login spiega che la registrazione continua; allo step documento il seller sceglie il tipo (carta d'identità, patente, passaporto), il numero è controllato per tipo, il documento non può essere scaduto e la foto si vede in anteprima.

**Architecture:** Un modulo puro senza import (`apps/api/src/lib/schemas/forms/identity-document.ts`), esportato da `@bibs/api/schemas`, contiene tipi, formati, normalizzazione, scadenza e «oggi a Roma»: lo usano sia il form seller sia i servizi API. Nuova colonna `seller_profiles.document_type` (text enum + CHECK), propagata nel contratto (`DocumentBody`, `SellerProfileSchema`), nell'approvazione admin dei cambi documento e nella redazione per i dipendenti. Il login seller legge `?verified=1` / `?error=…` messi da better-auth.

**Tech Stack:** Bun + Elysia + Drizzle (API, `bun test`, testcontainers), TanStack Start + React Hook Form + TypeBox resolver + paraglide (seller/admin, Vitest), better-auth 1.7.7.

**Spec:** `docs/superpowers/specs/2026-10-13-seller-onboarding-document-design.md`

## Global Constraints

- Branch `feat/onboarding-documento`; mai commit su `main`. Conventional Commits, scope tra `api`, `seller`, `admin`, `db`, `onboarding`, `auth`.
- Tipi documento: esattamente `identity_card`, `driving_license`, `passport`.
- Colonna `document_type`: `text({ enum })` + CHECK `seller_profile_document_type_valid`, nullable. Niente `pgEnum`.
- Messaggi d'errore dell'API in italiano: «Numero del documento non valido per il tipo scelto (es. <esempio>)», «Il documento è scaduto», «Seleziona il tipo di documento».
- Scadenza: valido se `scadenza >= oggi` (Europe/Rome); scade oggi = valido.
- Ogni messaggio nuovo del seller/admin va in **entrambi** `messages/it.json` e `messages/en.json`.
- Il seller importa le regole da `@bibs/api/schemas`, mai da percorsi interni dell'API.
- Non lanciare `db:seed`, `db:push`, `infra:reset` (deny-list): il seed lo rilancia Marco.
- Il customer non cambia (né `callbackURL` né login).

## Review Focus

- Numero scritto «a mano» (`" ca 12345-ab. "`) → accettato e salvato come `CA12345AB`. Test in Task 1 (normalizzazione) e Task 3 (salvataggio normalizzato).
- Scadenza a cavallo della mezzanotte: alle 00:30 di Roma (22:30 UTC) «oggi» è già il giorno dopo. Test in Task 1 (`todayInRome`).
- Link scaduto: better-auth reindirizza a `/login?verified=1&error=TOKEN_EXPIRED` → deve vincere l'errore, non «Email confermata». Test in Task 6.
- Documento rifiutato (numero o scadenza): niente file su S3, lo stato resta `pending_document`. Test in Task 3.
- Richiesta di cambio documento salvata prima di questa modifica (senza `documentType`) → l'admin non la applica (400), i dati live restano intatti. Test in Task 2.

---

### Task 1: Modulo condiviso delle regole del documento

**Files:**
- Create: `apps/api/src/lib/schemas/forms/identity-document.ts`
- Modify: `apps/api/src/lib/schemas/forms/index.ts`
- Test: `apps/api/tests/lib/identity-document.test.ts`

**Interfaces:**
- Produces (da `@/lib/schemas/forms/identity-document`, riesportati da `@/lib/schemas/forms` e quindi da `@bibs/api/schemas`):
  - `IDENTITY_DOCUMENT_TYPES: readonly ["identity_card", "driving_license", "passport"]`
  - `type IdentityDocumentType = "identity_card" | "driving_license" | "passport"`
  - `DOCUMENT_NUMBER_EXAMPLES: Record<IdentityDocumentType, string>`
  - `normalizeDocumentNumber(value: string): string`
  - `isValidDocumentNumber(type: IdentityDocumentType, normalized: string): boolean`
  - `isDocumentExpired(expiry: string, today: string): boolean`
  - `todayInRome(now?: Date): string`

- [ ] **Step 1: Write the failing test**

`apps/api/tests/lib/identity-document.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	DOCUMENT_NUMBER_EXAMPLES,
	IDENTITY_DOCUMENT_TYPES,
	type IdentityDocumentType,
	isDocumentExpired,
	isValidDocumentNumber,
	normalizeDocumentNumber,
	todayInRome,
} from "@/lib/schemas/forms/identity-document";

describe("normalizeDocumentNumber", () => {
	it("porta in maiuscolo e tiene solo lettere e cifre", () => {
		expect(normalizeDocumentNumber(" ca 12345-ab. ")).toBe("CA12345AB");
	});
});

describe("isValidDocumentNumber", () => {
	const cases: [IdentityDocumentType, string, boolean][] = [
		["identity_card", "CA12345AB", true],
		["identity_card", "AX1234567", true],
		["identity_card", "CA1234AB", false],
		["identity_card", "U1T86I309C", false],
		["driving_license", "U1T86I309C", true],
		["driving_license", "MI1234567A", true],
		["driving_license", "U1T86I309", false],
		["driving_license", "CA12345AB", false],
		["passport", "YA1234567", true],
		["passport", "YA123456", false],
		["passport", "U1T86I309C", false],
	];
	for (const [type, number, valid] of cases) {
		it(`${type} ${number} → ${valid}`, () => {
			expect(isValidDocumentNumber(type, number)).toBe(valid);
		});
	}

	it("ogni esempio è valido per il suo tipo", () => {
		for (const type of IDENTITY_DOCUMENT_TYPES) {
			expect(isValidDocumentNumber(type, DOCUMENT_NUMBER_EXAMPLES[type])).toBe(
				true,
			);
		}
	});
});

describe("isDocumentExpired", () => {
	it("ieri è scaduto", () => {
		expect(isDocumentExpired("2026-10-12", "2026-10-13")).toBe(true);
	});
	it("oggi è ancora valido", () => {
		expect(isDocumentExpired("2026-10-13", "2026-10-13")).toBe(false);
	});
	it("domani è valido", () => {
		expect(isDocumentExpired("2026-10-14", "2026-10-13")).toBe(false);
	});
	it("confronta anche a cavallo d'anno", () => {
		expect(isDocumentExpired("2025-12-31", "2026-01-01")).toBe(true);
	});
});

describe("todayInRome", () => {
	it("formatta AAAA-MM-GG", () => {
		expect(todayInRome(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
	});
	it("usa il giorno di Roma, non quello UTC", () => {
		// 22:30 UTC del 13/10 = 00:30 del 14/10 a Roma (CEST, UTC+2).
		expect(todayInRome(new Date("2026-10-13T22:30:00Z"))).toBe("2026-10-14");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test tests/lib/identity-document.test.ts`
Expected: FAIL — `Cannot find module '@/lib/schemas/forms/identity-document'`.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/lib/schemas/forms/identity-document.ts`:

```ts
// Regole del documento d'identità condivise tra API e form seller
// (via `@bibs/api/schemas`): niente import, gira uguale su Bun e nel browser.

export const IDENTITY_DOCUMENT_TYPES = [
	"identity_card",
	"driving_license",
	"passport",
] as const;
// Non `DocumentType`: è già un'interfaccia globale del DOM.
export type IdentityDocumentType = (typeof IDENTITY_DOCUMENT_TYPES)[number];

// ponytail: formati da fonti non ufficiali (CIE, patente modello UE,
// passaporto). Se un documento vero viene rifiutato, allarga il pattern qui.
const NUMBER_PATTERNS: Record<IdentityDocumentType, RegExp> = {
	// CIE (CA12345AB) o 2 lettere + 7 cifre: la cartacea non vale dal 3/8/2026,
	// la teniamo per non respingere le CIE di vecchia generazione.
	identity_card: /^(?:[A-Z]{2}\d{5}[A-Z]{2}|[A-Z]{2}\d{7})$/,
	// Modello UE dal 2013 (U1 + 7 alfanumerici + lettera) o 2 lettere + 7 cifre + lettera.
	driving_license: /^(?:U1[A-Z0-9]{7}[A-Z]|[A-Z]{2}\d{7}[A-Z])$/,
	passport: /^[A-Z]{2}\d{7}$/,
};

/** Esempio per tipo: placeholder dell'input e messaggio d'errore. */
export const DOCUMENT_NUMBER_EXAMPLES: Record<IdentityDocumentType, string> = {
	identity_card: "CA12345AB",
	driving_license: "U1T86I309C",
	passport: "YA1234567",
};

/** Maiuscolo, solo lettere e cifre: «ca 12345-ab» → «CA12345AB». */
export function normalizeDocumentNumber(value: string): string {
	return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** true se il numero (già normalizzato) ha un formato ammesso per il tipo. */
export function isValidDocumentNumber(
	type: IdentityDocumentType,
	normalized: string,
): boolean {
	return NUMBER_PATTERNS[type].test(normalized);
}

/** Date AAAA-MM-GG: l'ordine tra stringhe è quello del calendario. */
export function isDocumentExpired(expiry: string, today: string): boolean {
	return expiry < today;
}

// en-CA formatta AAAA-MM-GG.
const romeDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" });

/** Data di oggi a Roma, AAAA-MM-GG. */
export function todayInRome(now: Date = new Date()): string {
	return romeDate.format(now);
}
```

In `apps/api/src/lib/schemas/forms/index.ts`, dopo l'export da `./onboarding`:

```ts
export {
	DOCUMENT_NUMBER_EXAMPLES,
	IDENTITY_DOCUMENT_TYPES,
	type IdentityDocumentType,
	isDocumentExpired,
	isValidDocumentNumber,
	normalizeDocumentNumber,
	todayInRome,
} from "./identity-document";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test tests/lib/identity-document.test.ts`
Expected: PASS (tutti).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/schemas/forms/identity-document.ts apps/api/src/lib/schemas/forms/index.ts apps/api/tests/lib/identity-document.test.ts
git commit -m "feat(onboarding): regole condivise del documento d'identità"
```

---

### Task 2: `documentType` nel DB e nel contratto API

**Files:**
- Modify: `apps/api/src/db/schemas/seller.ts` (colonna + CHECK)
- Create: `apps/api/src/db/migrations/0001_*.sql` + `meta/` (generati)
- Modify: `apps/api/src/lib/schemas/forms/onboarding.ts` (`DocumentBody`)
- Modify: `apps/api/src/lib/schemas/entities.ts:224` (`SellerProfileSchema`)
- Modify: `apps/api/src/modules/seller/routes/onboarding.ts` (route `/document`)
- Modify: `apps/api/src/modules/seller/services/onboarding.ts` (`DocumentParams`)
- Modify: `apps/api/src/modules/seller/routes/settings.ts:157-197` (route `/document`)
- Modify: `apps/api/src/modules/seller/services/settings.ts` (redazione ~riga 137, `DocumentChangeParams` ~riga 329)
- Modify: `apps/api/src/modules/admin/services/sellers.ts` (`approveChange`, ramo `document`)
- Modify: `apps/api/src/db/seed/fixtures/dev-seller.ts`, `apps/api/src/db/seed/fixtures/sellers.ts`
- Modify: `apps/seller/src/hooks/use-onboarding.ts` (`useUpdateDocument`)
- Modify: `apps/seller/src/lib/typebox-errors.ts` + `apps/seller/messages/{it,en}.json`
- Test: `apps/api/tests/integration/admin-sellers.test.ts`, `apps/api/tests/integration/seller-settings-employee-redaction.test.ts`, `apps/api/tests/lib/date-format.test.ts`, `apps/api/tests/modules/seller-settings-owner-only.test.ts`, `apps/api/tests/modules/registration-response-schema.test.ts`, `apps/api/tests/modules/registration.test.ts`

**Interfaces:**
- Consumes: `IDENTITY_DOCUMENT_TYPES`, `IdentityDocumentType` (Task 1).
- Produces:
  - `sellerProfile.documentType` (Drizzle, `IdentityDocumentType | null`).
  - `DocumentBody` con `documentType: IdentityDocumentType` (errore «Seleziona il tipo di documento»); `DocumentChangeBody` lo eredita.
  - `SellerProfileSchema.documentType: IdentityDocumentType | null`.
  - `updateDocument({ userId, documentType, documentNumber, documentExpiry, documentIssuedMunicipalityId, documentImage })`.
  - `requestDocumentChange({ sellerProfileId, documentType, documentNumber, documentExpiry, documentIssuedMunicipalityId, documentImage? })`.
  - `useUpdateDocument()` accetta `Static<typeof DocumentBody> & { documentImage: File }`.

- [ ] **Step 1: Aggiorna i test (falliscono)**

`apps/api/tests/integration/admin-sellers.test.ts`, tabella `for (const [changeType, changeData] of [...])` in `describe("approveChange")`: aggiungi `documentType` al caso «chiave senza URL» (così testa ancora la mezza immagine e non lo schema) e un caso col vecchio formato senza tipo:

```ts
		["vat", { vatNumber: 123 }],
		["document", { documentNumber: "x" }],
		// Richiesta salvata prima di documentType: non si applica.
		[
			"document",
			{
				documentNumber: "CA12345AB",
				documentExpiry: "2030-01-01",
				documentIssuedMunicipalityId: "m-1",
			},
		],
		// Chiave dell'immagine senza URL (o viceversa): documento a metà.
		[
			"document",
			{
				documentType: "identity_card",
				documentNumber: "CA12345AB",
				documentExpiry: "2030-01-01",
				documentIssuedMunicipalityId: "m-1",
				documentImageKey: "documents/x/y",
			},
		],
```

Il titolo del test usa `Object.keys(changeData).join(",")`: i due casi «document» nuovi hanno chiavi diverse, quindi i nomi restano unici.

Nel test `"applies a valid document change without a new image"`:

```ts
			changeData: {
				documentType: "passport",
				documentNumber: "YA1234567",
				documentExpiry: "2030-01-01",
				documentIssuedMunicipalityId: municipality.id,
			},
		});

		const updated = await approveChange(change.id, adminId);

		expect(updated.status).toBe("approved");
		const [profile] = await db
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, seller.profile.id));
		expect(profile.documentNumber).toBe("YA1234567");
		expect(profile.documentType).toBe("passport");
```

`apps/api/tests/integration/seller-settings-employee-redaction.test.ts`: in `seedSellerWithEmployee`, nel `.set({...})` aggiungi `documentType: "identity_card",`; nel test dei dipendenti, accanto a `expect(result.profile.documentNumber).toBeNull();`:

```ts
		expect(result.profile.documentType).toBeNull();
```

Se nello stesso file c'è un test owner che verifica `documentNumber` («CA12345AB»), aggiungi lì `expect(result.profile.documentType).toBe("identity_card");`.

`apps/api/tests/lib/date-format.test.ts`, `const DOCUMENT`:

```ts
const DOCUMENT = {
	documentType: "identity_card",
	documentNumber: "CA12345AB",
	documentExpiry: "2030-01-01",
	documentIssuedMunicipalityId: "some-municipality",
};
```

`apps/api/tests/modules/seller-settings-owner-only.test.ts`, `const DOCUMENT`: stessa forma qui sopra (senza `documentType` il body darebbe 422 prima del 403).

`apps/api/tests/modules/registration-response-schema.test.ts` e `apps/api/tests/modules/registration.test.ts`: nel profilo seller finto, dopo `documentNumber: null,` aggiungi `documentType: null,`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && bun test tests/lib/date-format.test.ts tests/modules/registration-response-schema.test.ts && bun test tests/integration/admin-sellers.test.ts tests/integration/seller-settings-employee-redaction.test.ts --isolate --timeout 180000`
Expected: FAIL — errori di tipo/`documentType` assente (`profile.documentType` undefined, redazione non nulla, Drizzle che non conosce la colonna). `date-format` può ancora passare (proprietà in più): va bene.

- [ ] **Step 3: Colonna DB e migrazione**

`apps/api/src/db/schemas/seller.ts` — import relativo (drizzle-kit carica questo file da solo):

```ts
import { IDENTITY_DOCUMENT_TYPES } from "../../lib/schemas/forms/identity-document";
```

Nel blocco «Documento identità», prima di `documentNumber`:

```ts
		documentType: text("document_type", { enum: IDENTITY_DOCUMENT_TYPES }),
```

Nell'array dei vincoli, dopo `seller_profile_onboarding_status_valid`:

```ts
		check(
			"seller_profile_document_type_valid",
			sql`${table.documentType} IN ('identity_card','driving_license','passport')`,
		),
```

Run: `cd apps/api && bun run db:generate`
Expected: un nuovo `src/db/migrations/0001_<nome>.sql` con esattamente:

```sql
ALTER TABLE "seller_profiles" ADD COLUMN "document_type" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profile_document_type_valid" CHECK ("seller_profiles"."document_type" IN ('identity_card','driving_license','passport'));
```

Se contiene altro (es. `pg_trgm`, colonne non nostre), fermati e segnalalo. Poi `bun run db:migrate` (DB locale acceso; se esce 1 senza messaggio vedi la memoria «drizzle-kit migrate exit 1 muto»).

- [ ] **Step 4: Contratto API**

`apps/api/src/lib/schemas/forms/onboarding.ts`:

```ts
import { Type } from "@sinclair/typebox";
import { IDENTITY_DOCUMENT_TYPES } from "./identity-document";
```

```ts
export const DocumentBody = Type.Object({
	documentType: Type.Union(
		IDENTITY_DOCUMENT_TYPES.map((type) => Type.Literal(type)),
		{
			description: "Tipo di documento d'identità",
			error: "Seleziona il tipo di documento",
		},
	),
	documentNumber: Type.String({
		minLength: 5,
		maxLength: 20,
		description: "Numero del documento d'identità",
		error: "Il numero del documento deve avere tra 5 e 20 caratteri",
	}),
	// documentExpiry e documentIssuedMunicipalityId invariati
```

`apps/api/src/lib/schemas/entities.ts`, in `SellerProfileSchema` prima di `documentNumber`:

```ts
	documentType: t.Nullable(
		t.Union(
			[
				t.Literal("identity_card"),
				t.Literal("driving_license"),
				t.Literal("passport"),
			],
			{ description: "Tipo di documento d'identità" },
		),
	),
```

`apps/api/src/modules/seller/routes/onboarding.ts`, handler `/document`:

```ts
			const data = await updateDocument({
				userId: user.id,
				documentType: body.documentType,
				documentNumber: body.documentNumber,
				documentExpiry: body.documentExpiry,
				documentIssuedMunicipalityId: body.documentIssuedMunicipalityId,
				documentImage: body.documentImage,
			});
```

e `description: "Foto del documento d'identità"` su `t.File`.

`apps/api/src/modules/seller/services/onboarding.ts`:

```ts
import type { IdentityDocumentType } from "@/lib/schemas/forms/identity-document";
```

```ts
interface DocumentParams {
	userId: string;
	documentType: IdentityDocumentType;
	documentNumber: string;
	documentExpiry: string;
	documentIssuedMunicipalityId: string;
	documentImage: File;
}
```

(`...data` lo scrive già in `.set`.)

`apps/api/src/modules/seller/routes/settings.ts`, handler `/document`: aggiungi `documentType: ctx.body.documentType,` prima di `documentNumber`; `description: "Nuova foto del documento d'identità"` su `t.File`.

`apps/api/src/modules/seller/services/settings.ts`: in `DocumentChangeParams` aggiungi `documentType: IdentityDocumentType;` (stesso import type); nel blocco `if (!isOwner)` aggiungi `documentType: null,` prima di `documentNumber: null,`.

`apps/api/src/modules/admin/services/sellers.ts`, `approveChange` ramo `document`:

```ts
				.set({
					documentType: doc.documentType,
					documentNumber: doc.documentNumber,
```

- [ ] **Step 5: Seed**

`apps/api/src/db/seed/fixtures/dev-seller.ts`: `documentType: "identity_card",` prima di `documentNumber: "AX0000001",`.

`apps/api/src/db/seed/fixtures/sellers.ts`:
- import: `import type { IdentityDocumentType } from "@/lib/schemas/forms/identity-document";`
- nel tipo `profileFields`: `documentType: IdentityDocumentType | null;` prima di `documentNumber`.
- nel generatore, prima di `documentNumber:`:

```ts
					// «AX» + 7 cifre è valido sia come carta d'identità sia come passaporto.
					documentType: hasDocument
						? idx % 2 === 0
							? "identity_card"
							: "passport"
						: null,
```

- nell'insert, prima di `documentNumber: data.profileFields.documentNumber,`: `documentType: data.profileFields.documentType,`.

- [ ] **Step 6: Seller — tipi e traduzione del nuovo `error:`**

`apps/seller/src/hooks/use-onboarding.ts`:

```ts
import type { DocumentBody } from "@bibs/api/schemas";
import type { Static } from "@sinclair/typebox";
```

```ts
export function useUpdateDocument() {
	return useOnboardingMutation(
		async (params: Static<typeof DocumentBody> & { documentImage: File }) => {
			const response = await api().seller.onboarding.document.patch(params);
			return unwrap(response, m.onboarding_document_save_error());
		},
	);
}
```

(Se il file importa già `@sinclair/typebox` o `@bibs/api/schemas`, unisci gli import.)

`apps/seller/src/lib/typebox-errors.ts`, in `SCHEMA_ERRORS` prima della voce del numero:

```ts
	"Seleziona il tipo di documento": m.validation_schema_document_type,
```

`apps/seller/messages/it.json`, dopo `validation_schema_document_municipality`:

```json
	"validation_schema_document_type": "Seleziona il tipo di documento",
```

`apps/seller/messages/en.json`, stessa posizione:

```json
	"validation_schema_document_type": "Select the document type",
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && bun run test:unit && bun test tests/integration/admin-sellers.test.ts tests/integration/seller-settings-employee-redaction.test.ts tests/integration/seller-settings.test.ts --isolate --timeout 180000`
Expected: PASS.

Run: `cd apps/seller && bun run test -- src/lib/typebox-errors.test.ts && bun run typecheck`
Expected: PASS (il test «ogni `error:` … ha la sua traduzione» copre la voce nuova). `cd apps/api && bun run typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api apps/seller/src/hooks/use-onboarding.ts apps/seller/src/lib/typebox-errors.ts apps/seller/messages
git commit -m "feat(onboarding): tipo di documento d'identità nel profilo seller"
```

---

### Task 3: Controllo di numero e scadenza lato API

**Files:**
- Create: `apps/api/src/modules/seller/services/document-check.ts`
- Modify: `apps/api/src/modules/seller/services/onboarding.ts` (`updateDocument`)
- Modify: `apps/api/src/modules/seller/services/settings.ts` (`requestDocumentChange`)
- Test: `apps/api/tests/integration/seller-onboarding-document.test.ts` (nuovo), `apps/api/tests/integration/seller-settings-change-requests.test.ts`

**Interfaces:**
- Consumes: modulo di Task 1; `updateDocument` / `requestDocumentChange` con `documentType` (Task 2).
- Produces: `checkDocument(doc: { documentType: IdentityDocumentType; documentNumber: string; documentExpiry: string }): string` — restituisce il numero normalizzato, lancia `ServiceError(422, …)`.

`checkDocument` sta in un file suo: `settings.ts` carica `@/lib/s3` con import dinamico, e importare `onboarding.ts` (che lo importa statico) lo tirerebbe dentro.

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/integration/seller-onboarding-document.test.ts`:

```ts
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

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

const write = mock(async () => {});
mock.module("@/lib/s3", () => ({
	s3: { write, delete: mock(async () => {}) },
	publicUrl: (key: string) => `https://cdn.test/${key}`,
}));

import { eq } from "drizzle-orm";
import { sellerProfile } from "@/db/schemas/seller";
import { updateDocument } from "@/modules/seller/services/onboarding";
import { truncateAll } from "../helpers/cleanup";
import { createTestMunicipality, createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	write.mockClear();
});

async function sellerAtDocumentStep() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	await db
		.update(sellerProfile)
		.set({ onboardingStatus: "pending_document" })
		.where(eq(sellerProfile.id, seller.profile.id));
	const municipality = await createTestMunicipality(db);
	return { userId: seller.user.id, municipalityId: municipality.id };
}

const image = () =>
	new File([new Uint8Array([1, 2, 3])], "doc.jpg", { type: "image/jpeg" });

async function statusOf(userId: string) {
	const [row] = await getTestDb()
		.select()
		.from(sellerProfile)
		.where(eq(sellerProfile.userId, userId));
	return row.onboardingStatus;
}

describe("updateDocument", () => {
	it("salva tipo e numero normalizzato e passa a pending_company", async () => {
		const { userId, municipalityId } = await sellerAtDocumentStep();

		const profile = await updateDocument({
			userId,
			documentType: "passport",
			documentNumber: " ya 1234567 ",
			documentExpiry: "2099-12-31",
			documentIssuedMunicipalityId: municipalityId,
			documentImage: image(),
		});

		expect(profile.documentType).toBe("passport");
		expect(profile.documentNumber).toBe("YA1234567");
		expect(profile.onboardingStatus).toBe("pending_company");
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("rifiuta con 422 un numero che non è del tipo scelto, senza caricare la foto", async () => {
		const { userId, municipalityId } = await sellerAtDocumentStep();

		await expect(
			updateDocument({
				userId,
				documentType: "passport",
				documentNumber: "CA12345AB",
				documentExpiry: "2099-12-31",
				documentIssuedMunicipalityId: municipalityId,
				documentImage: image(),
			}),
		).rejects.toMatchObject({ status: 422 });

		expect(write).not.toHaveBeenCalled();
		expect(await statusOf(userId)).toBe("pending_document");
	});

	it("rifiuta con 422 un documento scaduto, senza caricare la foto", async () => {
		const { userId, municipalityId } = await sellerAtDocumentStep();

		await expect(
			updateDocument({
				userId,
				documentType: "identity_card",
				documentNumber: "CA12345AB",
				documentExpiry: "2020-01-01",
				documentIssuedMunicipalityId: municipalityId,
				documentImage: image(),
			}),
		).rejects.toMatchObject({ status: 422, message: "Il documento è scaduto" });

		expect(write).not.toHaveBeenCalled();
		expect(await statusOf(userId)).toBe("pending_document");
	});
});
```

`apps/api/tests/integration/seller-settings-change-requests.test.ts`:
- dopo il `mock.module("@/db", …)` esistente, aggiungi il mock S3 (la richiesta importa `@/lib/s3` anche senza foto):

```ts
mock.module("@/lib/s3", () => ({
	s3: { write: mock(async () => {}), delete: mock(async () => {}) },
	publicUrl: (key: string) => `https://cdn.test/${key}`,
}));
```

- import: `requestDocumentChange` accanto a `requestVatChange`; `createTestMunicipality` accanto a `createTestOrganization, createTestSeller`.
- in fondo al file:

```ts
describe("requestDocumentChange", () => {
	it("salva il tipo e il numero normalizzato", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const municipality = await createTestMunicipality(db);

		const change = await requestDocumentChange({
			sellerProfileId: seller.profile.id,
			documentType: "identity_card",
			documentNumber: "ca 12345 ab",
			documentExpiry: "2099-12-31",
			documentIssuedMunicipalityId: municipality.id,
		});

		expect(change.changeData).toMatchObject({
			documentType: "identity_card",
			documentNumber: "CA12345AB",
		});
	});

	it("rifiuta con 422 un documento scaduto e non salva la richiesta", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const municipality = await createTestMunicipality(db);

		await expect(
			requestDocumentChange({
				sellerProfileId: seller.profile.id,
				documentType: "identity_card",
				documentNumber: "CA12345AB",
				documentExpiry: "2020-01-01",
				documentIssuedMunicipalityId: municipality.id,
			}),
		).rejects.toMatchObject({ status: 422 });

		expect(await db.select().from(sellerProfileChange)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && bun test tests/integration/seller-onboarding-document.test.ts tests/integration/seller-settings-change-requests.test.ts --isolate --timeout 180000`
Expected: FAIL — il numero salvato è `" ya 1234567 "`, i casi 422 si risolvono invece di rifiutare.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/modules/seller/services/document-check.ts`:

```ts
import { ServiceError } from "@/lib/errors";
import {
	DOCUMENT_NUMBER_EXAMPLES,
	type IdentityDocumentType,
	isDocumentExpired,
	isValidDocumentNumber,
	normalizeDocumentNumber,
	todayInRome,
} from "@/lib/schemas/forms/identity-document";

/**
 * Controlla numero (per tipo) e scadenza di un documento: 422 con il messaggio
 * per l'utente. Restituisce il numero normalizzato, quello da salvare.
 */
export function checkDocument(doc: {
	documentType: IdentityDocumentType;
	documentNumber: string;
	documentExpiry: string;
}): string {
	const documentNumber = normalizeDocumentNumber(doc.documentNumber);
	if (!isValidDocumentNumber(doc.documentType, documentNumber)) {
		throw new ServiceError(
			422,
			`Numero del documento non valido per il tipo scelto (es. ${DOCUMENT_NUMBER_EXAMPLES[doc.documentType]})`,
		);
	}
	if (isDocumentExpired(doc.documentExpiry, todayInRome())) {
		throw new ServiceError(422, "Il documento è scaduto");
	}
	return documentNumber;
}
```

`apps/api/src/modules/seller/services/onboarding.ts`, `updateDocument`, dopo `assertStatus(...)` e prima dell'upload:

```ts
	const documentNumber = checkDocument(data);

	// Upload document image to S3
	...
		.set({
			...data,
			documentNumber,
			documentImageKey: key,
```

(import: `import { checkDocument } from "./document-check";`)

`apps/api/src/modules/seller/services/settings.ts`, `requestDocumentChange`, dopo `await assertNoPendingChange(sellerProfileId, "document");` e prima di `await import("@/lib/s3")`:

```ts
	const documentNumber = checkDocument(data);
```

e `changeData: { ...data, documentNumber, ...imageData },` (import come sopra).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && bun test tests/integration/seller-onboarding-document.test.ts tests/integration/seller-settings-change-requests.test.ts --isolate --timeout 180000 && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services apps/api/tests/integration/seller-onboarding-document.test.ts apps/api/tests/integration/seller-settings-change-requests.test.ts
git commit -m "feat(onboarding): numero per tipo e scadenza controllati dall'API"
```

---

### Task 4: Form documento del seller (tipo, controlli, anteprima)

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/onboarding/document.tsx`
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`

**Interfaces:**
- Consumes: da `@bibs/api/schemas` — `DocumentBody`, `IDENTITY_DOCUMENT_TYPES`, `IdentityDocumentType`, `DOCUMENT_NUMBER_EXAMPLES`, `normalizeDocumentNumber`, `isValidDocumentNumber`, `isDocumentExpired`, `todayInRome` (Task 1); `useUpdateDocument` tipizzato (Task 2).
- Produces: niente per altri task.

Niente test automatico nuovo: la logica sta nel modulo già testato (Task 1) e nell'API (Task 3); qui c'è solo il collegamento al form, verificato con typecheck, build e smoke di Marco (Task 7).

- [ ] **Step 1: Messaggi**

`apps/seller/messages/it.json` — cambia `onboarding_document_description` in `"Carica un documento d'identità"` e aggiungi dopo `onboarding_document_upload_error`:

```json
	"onboarding_document_type": "Tipo di documento",
	"onboarding_document_type_placeholder": "Seleziona il tipo",
	"onboarding_document_type_identity_card": "Carta d'identità",
	"onboarding_document_type_driving_license": "Patente di guida",
	"onboarding_document_type_passport": "Passaporto",
	"onboarding_document_number_invalid": "Numero non valido per il tipo scelto (es. {example})",
	"onboarding_document_expired": "Il documento è scaduto",
	"onboarding_document_photo_preview_alt": "Anteprima del documento",
```

`apps/seller/messages/en.json` — `onboarding_document_description`: `"Upload an identity document"`; stessa posizione:

```json
	"onboarding_document_type": "Document type",
	"onboarding_document_type_placeholder": "Select the type",
	"onboarding_document_type_identity_card": "Identity card",
	"onboarding_document_type_driving_license": "Driving licence",
	"onboarding_document_type_passport": "Passport",
	"onboarding_document_number_invalid": "Invalid number for the selected type (e.g. {example})",
	"onboarding_document_expired": "The document has expired",
	"onboarding_document_photo_preview_alt": "Document preview",
```

- [ ] **Step 2: Import ed etichette**

In `document.tsx` sostituisci l'import di `DocumentBody` e di React:

```tsx
import {
	DOCUMENT_NUMBER_EXAMPLES,
	DocumentBody,
	IDENTITY_DOCUMENT_TYPES,
	type IdentityDocumentType,
	isDocumentExpired,
	isValidDocumentNumber,
	normalizeDocumentNumber,
	todayInRome,
} from "@bibs/api/schemas";
```

```tsx
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
```

```tsx
import { useEffect, useState } from "react";
```

Sotto `const compiledSchema = …`:

```tsx
const DOCUMENT_TYPE_LABEL: Record<IdentityDocumentType, () => string> = {
	identity_card: m.onboarding_document_type_identity_card,
	driving_license: m.onboarding_document_type_driving_license,
	passport: m.onboarding_document_type_passport,
};
```

- [ ] **Step 3: Stato, anteprima e submit**

In `DocumentPage`, dopo `const [fileError, setFileError] = useState("");`:

```tsx
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	// L'URL nasce e muore nell'effetto: con StrictMode un URL creato in render
	// verrebbe revocato mentre è ancora a schermo.
	useEffect(() => {
		if (!documentImage) {
			setPreviewUrl(null);
			return;
		}
		const url = URL.createObjectURL(documentImage);
		setPreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [documentImage]);
```

Nel `useForm`, aggiungi `setError` e `watch` alla destrutturazione:

```tsx
	const {
		register,
		handleSubmit,
		control,
		setError,
		watch,
		formState: { errors, isSubmitting },
	} = useForm<DocumentFormData>({
		resolver: typeboxResolver(compiledSchema),
	});
	const documentType = watch("documentType");
```

Sostituisci `onSubmit`:

```tsx
	const onSubmit: SubmitHandler<DocumentFormData> = async (data) => {
		setApiError("");
		// Gli stessi controlli dell'API, qui per avere l'errore sotto il campo.
		const documentNumber = normalizeDocumentNumber(data.documentNumber);
		let invalid = false;
		if (!isValidDocumentNumber(data.documentType, documentNumber)) {
			setError("documentNumber", {
				message: m.onboarding_document_number_invalid({
					example: DOCUMENT_NUMBER_EXAMPLES[data.documentType],
				}),
			});
			invalid = true;
		}
		if (isDocumentExpired(data.documentExpiry, todayInRome())) {
			setError("documentExpiry", { message: m.onboarding_document_expired() });
			invalid = true;
		}
		if (!documentImage) {
			setFileError(m.onboarding_document_photo_required());
			invalid = true;
		}
		if (invalid || !documentImage) return;
		try {
			await mutation.mutateAsync({ ...data, documentNumber, documentImage });
			void navigate({ to: "/onboarding/company" });
		} catch (err) {
			setApiError(
				err instanceof Error
					? err.message
					: m.onboarding_document_upload_error(),
			);
		}
	};
```

- [ ] **Step 4: Campi**

Prima del campo `documentNumber`, il select del tipo (prende l'`autoFocus`, che va tolto dall'input del numero):

```tsx
				<Field data-invalid={!!errors.documentType}>
					<FieldLabel htmlFor="documentType">
						{m.onboarding_document_type()}
					</FieldLabel>
					<NativeSelect
						id="documentType"
						className="w-full"
						autoFocus
						{...register("documentType")}
					>
						<NativeSelectOption value="">
							{m.onboarding_document_type_placeholder()}
						</NativeSelectOption>
						{IDENTITY_DOCUMENT_TYPES.map((type) => (
							<NativeSelectOption key={type} value={type}>
								{DOCUMENT_TYPE_LABEL[type]()}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<FieldError errors={[errors.documentType]} />
				</Field>
```

Input del numero:

```tsx
					<Input
						id="documentNumber"
						placeholder={
							DOCUMENT_NUMBER_EXAMPLES[documentType] ??
							DOCUMENT_NUMBER_EXAMPLES.identity_card
						}
						{...register("documentNumber")}
					/>
```

(`documentType` è `""` o `undefined` finché non si sceglie: l'indicizzazione dà `undefined`, da qui il `??`. Se il typecheck protesta sull'indice, usa `DOCUMENT_NUMBER_EXAMPLES[documentType as IdentityDocumentType]`.)

Input della scadenza: aggiungi `min={todayInRome()}`.

In `DropzoneContent`, sostituisci il primo `div` con l'icona:

```tsx
							<div className="flex flex-col items-center justify-center">
								{previewUrl ? (
									<img
										src={previewUrl}
										alt={m.onboarding_document_photo_preview_alt()}
										className="max-h-48 w-auto rounded-md object-contain"
									/>
								) : (
									<div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
										<UploadIcon className="size-4" />
									</div>
								)}
								<p className="my-2 text-sm font-medium">
									{m.onboarding_document_photo_uploaded()}
								</p>
```

(il resto di `DropzoneContent` invariato).

- [ ] **Step 5: Verifica**

Run: `cd apps/seller && bun run test && bun run typecheck && bun run build`
Expected: PASS; build senza errori.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/routes/_authenticated/onboarding/document.tsx apps/seller/messages
git commit -m "feat(seller): tipo di documento, controlli e anteprima della foto nell'onboarding"
```

---

### Task 5: Tipo di documento nel dettaglio venditore (admin)

**Files:**
- Modify: `apps/admin/src/routes/_authenticated/sellers/$sellerId.tsx` (sezione documento, ~riga 177)
- Modify: `apps/admin/messages/it.json`, `apps/admin/messages/en.json`

**Interfaces:**
- Consumes: `seller.documentType: "identity_card" | "driving_license" | "passport" | null` dalla risposta del dettaglio (Task 2).

- [ ] **Step 1: Messaggi**

`apps/admin/messages/it.json`, dopo `sellers_section_document`:

```json
	"sellers_document_type": "Tipo",
	"sellers_document_type_identity_card": "Carta d'identità",
	"sellers_document_type_driving_license": "Patente di guida",
	"sellers_document_type_passport": "Passaporto",
```

`apps/admin/messages/en.json`, stessa posizione:

```json
	"sellers_document_type": "Type",
	"sellers_document_type_identity_card": "Identity card",
	"sellers_document_type_driving_license": "Driving licence",
	"sellers_document_type_passport": "Passport",
```

- [ ] **Step 2: Campo**

A livello di modulo in `$sellerId.tsx`:

```tsx
const DOCUMENT_TYPE_LABEL = {
	identity_card: m.sellers_document_type_identity_card,
	driving_license: m.sellers_document_type_driving_license,
	passport: m.sellers_document_type_passport,
} as const;
```

Primo campo di `<Section title={m.sellers_section_document()}>`:

```tsx
							<Field
								label={m.sellers_document_type()}
								value={
									seller.documentType
										? DOCUMENT_TYPE_LABEL[seller.documentType]()
										: null
								}
							/>
```

- [ ] **Step 3: Verifica**

Run: `cd apps/admin && bun run test && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/admin/src/routes/_authenticated/sellers/\$sellerId.tsx" apps/admin/messages
git commit -m "feat(admin): tipo di documento nel dettaglio venditore"
```

---

### Task 6: Login seller dopo il link di verifica email

**Files:**
- Create: `apps/seller/src/features/auth/components/verify-link-notice.tsx`
- Test: `apps/seller/src/features/auth/components/verify-link-notice.test.tsx`
- Modify: `apps/seller/src/routes/login.tsx`
- Modify: `apps/api/src/modules/registration/services.ts:53-57` (`callbackURLForRole`)
- Modify: `apps/seller/src/routes/verify-email.tsx:48`, `apps/seller/src/features/auth/components/pending-verification-banner-connected.tsx:38`
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`

**Interfaces:**
- Produces: `VerifyLinkNotice({ verified?: boolean; error?: string })`; route `/login` con search `{ verified?: boolean; error?: string }`.

- [ ] **Step 1: Write the failing test**

`apps/seller/src/features/auth/components/verify-link-notice.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { VerifyLinkNotice } from "./verify-link-notice";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

function text(node: React.ReactElement) {
	return renderToStaticMarkup(node)
		.replace(/<[^>]+>/g, "")
		.trim();
}

describe("VerifyLinkNotice", () => {
	it("dopo la verifica dice di accedere per continuare la registrazione", () => {
		overwriteGetLocale(() => "it");
		expect(text(<VerifyLinkNotice verified />)).toContain(
			"Accedi per continuare la registrazione",
		);
	});

	it("con un errore dice che il link non vale, anche se c'è verified", () => {
		overwriteGetLocale(() => "it");
		const out = text(<VerifyLinkNotice verified error="TOKEN_EXPIRED" />);
		expect(out).toContain("Il link non è più valido");
		expect(out).not.toContain("Email confermata");
	});

	it("senza parametri non mostra niente", () => {
		expect(renderToStaticMarkup(<VerifyLinkNotice />)).toBe("");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/seller && bun run test -- src/features/auth/components/verify-link-notice.test.tsx`
Expected: FAIL — modulo `./verify-link-notice` inesistente.

- [ ] **Step 3: Messaggi e componente**

`apps/seller/messages/it.json`, dopo `auth_login_unverified`:

```json
	"auth_login_email_verified": "Email confermata! Accedi per continuare la registrazione: ti chiederemo dati anagrafici, documento e dati dell'azienda.",
	"auth_login_verify_link_invalid": "Il link non è più valido. Accedi e chiedi una nuova email di verifica.",
```

`apps/seller/messages/en.json`, stessa posizione:

```json
	"auth_login_email_verified": "Email confirmed! Sign in to continue your registration: we'll ask for your personal details, an ID document and your company details.",
	"auth_login_verify_link_invalid": "This link is no longer valid. Sign in to request a new verification email.",
```

`apps/seller/src/features/auth/components/verify-link-notice.tsx`:

```tsx
import { m } from "@/paraglide/messages";

/**
 * Banner del login quando si arriva dal link di verifica email: better-auth
 * reindirizza a `/login?verified=1` e aggiunge `&error=…` se il link è
 * scaduto o non valido. L'errore vince.
 */
export function VerifyLinkNotice({
	verified,
	error,
}: {
	verified?: boolean;
	error?: string;
}) {
	if (error) {
		return (
			<div
				role="alert"
				className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
			>
				{m.auth_login_verify_link_invalid()}
			</div>
		);
	}
	if (verified) {
		return (
			<div
				role="status"
				className="mb-4 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-foreground"
			>
				{m.auth_login_email_verified()}
			</div>
		);
	}
	return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/seller && bun run test -- src/features/auth/components/verify-link-notice.test.tsx`
Expected: PASS.

- [ ] **Step 5: Collega login e callbackURL**

`apps/seller/src/routes/login.tsx`:

```tsx
import { z } from "zod";
import { VerifyLinkNotice } from "@/features/auth/components/verify-link-notice";

const searchSchema = z.object({
	// Dal link di verifica email (vedi VerifyLinkNotice).
	verified: z.coerce.boolean().optional().catch(undefined),
	error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/login")({
	validateSearch: searchSchema,
	component: LoginPage,
});
```

In `LoginPage`: `const { verified, error: linkError } = Route.useSearch();` e come primo figlio di `<CardContent>`:

```tsx
					<VerifyLinkNotice verified={verified} error={linkError} />
```

`apps/api/src/modules/registration/services.ts`:

```ts
function callbackURLForRole(role: "seller" | "customer"): string {
	// verified=1: il login seller spiega che la registrazione continua.
	return role === "seller"
		? `${env.SELLER_APP_URL}/login?verified=1`
		: `${env.CUSTOMER_APP_URL}/login`;
}
```

`apps/seller/src/routes/verify-email.tsx` e `apps/seller/src/features/auth/components/pending-verification-banner-connected.tsx`:

```ts
				callbackURL: `${window.location.origin}/login?verified=1`,
```

- [ ] **Step 6: Verifica**

Run: `cd apps/seller && bun run test && bun run typecheck` e `cd apps/api && bun run typecheck && bun run test:unit`
Expected: PASS. Se il typecheck segnala `Link to="/login"` / `navigate({ to: "/login" })` senza `search`, non serve passarlo: i parametri sono tutti opzionali; controlla che lo schema li dichiari `.optional()`.

- [ ] **Step 7: Commit**

```bash
git add apps/seller/src/features/auth/components/verify-link-notice.tsx apps/seller/src/features/auth/components/verify-link-notice.test.tsx apps/seller/src/routes/login.tsx apps/seller/src/routes/verify-email.tsx apps/seller/src/features/auth/components/pending-verification-banner-connected.tsx apps/seller/messages apps/api/src/modules/registration/services.ts
git commit -m "feat(auth): il login seller spiega come continuare dopo la verifica email"
```

---

### Task 7: Verifica finale

**Files:** nessuno (solo comandi), salvo correzioni.

- [ ] **Step 1: Gate automatici**

Run (dalla root):

```bash
bun run lint
bun run typecheck
bun run test
cd apps/seller && bun run build
```

Expected: tutto verde. `bun run --filter` può nascondere un workspace fallito: controlla l'exit code di ogni workspace nell'output, non solo l'ultimo.

- [ ] **Step 2: DB locale**

`bun run db:migrate` già fatto in Task 2. Chiedi a Marco di lanciare `! bun run db:seed` (o `db:reset`) per avere `documentType` sui seller del seed.

- [ ] **Step 3: Smoke manuale (Marco)**

Seller su `localhost:3002`, Mailpit su `:8025`:
1. Registrazione → email in Mailpit → click sul link → login con banner «Email confermata! …».
2. Link già usato o manomesso (cambia un carattere del token) → banner «Il link non è più valido…».
3. Login → dati anagrafici → step documento: tipo vuoto → «Seleziona il tipo di documento»; passaporto + `CA12345AB` → errore con «es. YA1234567»; scadenza ieri → «Il documento è scaduto»; il calendario non propone date passate.
4. Carica una foto → anteprima; trascinane un'altra → anteprima sostituita.
5. Invia con `ya 1234567` → step aziendale; admin `localhost:3003` → dettaglio venditore mostra «Passaporto» e `YA1234567`.
6. Anche con mouse e tastiera (Tab sul select, invio).

- [ ] **Step 4: PR**

Dopo l'ok di Marco sullo smoke: push del branch e PR (Conventional title `feat(onboarding): verifica email più chiara e documento d'identità per tipo`).
