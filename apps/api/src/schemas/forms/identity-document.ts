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
