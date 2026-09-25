// Stesso alfabeto di apps/api/src/lib/pickup-code.ts: 6 caratteri senza quelli
// che si confondono (0/O, 1/I/L). Tenerli allineati.
const PICKUP_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export function normalizePickupCode(input: string): string {
	return input.toUpperCase().replace(/[\s-]/g, "");
}

export function isCompletePickupCode(code: string): boolean {
	return PICKUP_CODE_RE.test(code);
}

/** Codice raggruppato 3-3 (`K7X M4P`), come lo vede il cliente. */
export function formatPickupCode(code: string): string {
	return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
