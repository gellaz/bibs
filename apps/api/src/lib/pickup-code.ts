/**
 * Codice di ritiro: identifica un ordine al banco, NON è un segreto (il seller
 * può già chiudere gli ordini dei suoi negozi). Corto, leggibile a voce, senza
 * caratteri che si confondono (0/O, 1/I/L).
 */
export const PICKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PICKUP_CODE_LENGTH = 6;

// Il più grande multiplo di 31 che sta in un byte: sopra si scarta, così ogni
// simbolo ha la stessa probabilità.
const LIMIT =
	Math.floor(256 / PICKUP_CODE_ALPHABET.length) * PICKUP_CODE_ALPHABET.length;

export function generatePickupCode(
	random: (n: number) => Uint8Array = (n) =>
		crypto.getRandomValues(new Uint8Array(n)),
): string {
	let out = "";
	while (out.length < PICKUP_CODE_LENGTH) {
		for (const b of random(PICKUP_CODE_LENGTH)) {
			if (b >= LIMIT) continue;
			out += PICKUP_CODE_ALPHABET[b % PICKUP_CODE_ALPHABET.length];
			if (out.length === PICKUP_CODE_LENGTH) break;
		}
	}
	return out;
}

export function normalizePickupCode(input: string): string {
	return input.toUpperCase().replace(/[\s-]/g, "");
}
