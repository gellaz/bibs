import { z } from "zod";
import { zFormat, zString } from "@/lib/schemas/t";

// Gemelli Zod di `lib/schemas/forms/onboarding.ts` (D3 del piano Hono), stessi
// nomi; si aggiungono quando una route migrata li usa. In U11b prendono il
// posto del file TypeBox (`@bibs/api/schemas`).

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZIP = /^\d{5}$/;
const VAT = /^[0-9]{11}$/;

/** Testo obbligatorio con i limiti e il messaggio dello schema TypeBox. */
const text = (min: number, max: number, description: string, error: string) =>
	zString({ minLength: min, maxLength: max, description, error });

/**
 * `calendar-date` col pattern AAAA-MM-GG, come il `Type.String` TypeBox. Il
 * `.regex()` toglie il formato dal JSON Schema di Zod: lo rimette `meta`.
 */
const calendarDate = (description: string) =>
	zFormat("calendar-date").regex(DATE).meta({
		format: "calendar-date",
		description,
		error: "Data non valida (AAAA-MM-GG)",
	});

// ── Step 1: Personal Info ───────────────────

export const PersonalInfoBody = z.object({
	firstName: text(1, 100, "Nome", "Il nome è obbligatorio"),
	lastName: text(1, 100, "Cognome", "Il cognome è obbligatorio"),
	citizenship: text(
		2,
		2,
		"Cittadinanza (codice ISO alpha-2)",
		"Seleziona la cittadinanza",
	),
	birthCountry: text(
		2,
		2,
		"Paese di nascita (codice ISO alpha-2)",
		"Seleziona il paese di nascita",
	),
	birthDate: calendarDate("Data di nascita (YYYY-MM-DD)"),
	residenceCountry: text(
		2,
		2,
		"Paese di residenza (codice ISO alpha-2)",
		"Seleziona il paese di residenza",
	),
	residenceMunicipalityId: zString({
		minLength: 1,
		description: "ID del comune di residenza",
		error: "Il comune di residenza è obbligatorio",
	}),
	residenceAddress: text(
		1,
		200,
		"Indirizzo di residenza",
		"L'indirizzo di residenza è obbligatorio",
	),
	residenceZipCode: z.string().regex(ZIP).meta({
		description: "CAP residenza (5 cifre)",
		error: "Il CAP deve essere di 5 cifre",
	}),
});

// ── Step 2: Document ────────────────────────
// documentImage (zFile) si aggiunge nella route: il file è solo del server.

export const DocumentBody = z.object({
	documentType: z.enum(["identity_card", "driving_license", "passport"]).meta({
		description: "Tipo di documento d'identità",
		error: "Seleziona il tipo di documento",
	}),
	documentNumber: text(
		5,
		20,
		"Numero del documento d'identità",
		"Il numero del documento deve avere tra 5 e 20 caratteri",
	),
	documentExpiry: calendarDate("Scadenza documento (YYYY-MM-DD)"),
	documentIssuedMunicipalityId: zString({
		minLength: 1,
		description: "ID del comune di emissione del documento",
		error: "Il comune di emissione è obbligatorio",
	}),
});

// ── Step 3: Company ─────────────────────────

export const CompanyBody = z.object({
	businessName: text(
		1,
		200,
		"Ragione sociale",
		"La ragione sociale è obbligatoria",
	),
	vatNumber: z.string().regex(VAT).meta({
		description: "Partita IVA italiana (11 cifre)",
		error: "La partita IVA deve essere di 11 cifre",
	}),
	legalForm: text(
		1,
		100,
		"Forma giuridica (es. SRL, SAS, Ditta individuale)",
		"La forma giuridica è obbligatoria",
	),
	addressLine1: text(
		1,
		200,
		"Indirizzo sede legale",
		"L'indirizzo è obbligatorio",
	),
	country: zString({
		minLength: 2,
		maxLength: 2,
		description: "Codice paese ISO alpha-2 (default: IT)",
	}).optional(),
	municipalityId: zString({
		minLength: 1,
		description: "ID del comune della sede legale",
		error: "Il comune è obbligatorio",
	}),
	zipCode: z.string().regex(ZIP).meta({
		description: "CAP (5 cifre)",
		error: "Il CAP deve essere di 5 cifre",
	}),
});

// ── Team invite (used by employees module) ──

export const TeamInviteBody = z.object({
	email: zFormat("email").meta({
		description: "Email del collaboratore da invitare",
		error: "Inserisci un indirizzo email valido",
	}),
	storeIds: z.array(z.string()).min(1).meta({
		description: "ID dei negozi a cui assegnare il collaboratore (almeno 1)",
		error: "Seleziona almeno un negozio",
	}),
});

export const AcceptInviteBody = z.object({
	token: zString({
		minLength: 1,
		description: "Token dell'invito",
		error: "Token mancante",
	}),
	password: zString({
		minLength: 8,
		maxLength: 128,
		description: "Password (minimo 8, massimo 128 caratteri)",
		error: "La password deve avere almeno 8 caratteri",
	}),
	confirmPassword: zString({
		minLength: 8,
		maxLength: 128,
		description: "Conferma password",
		error: "La conferma password deve avere almeno 8 caratteri",
	}),
});
