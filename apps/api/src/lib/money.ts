/**
 * Converts a decimal string (e.g. "9.99") to integer cents (999).
 * Avoids floating-point arithmetic errors.
 */
export function toCents(price: string): number {
	// Detect the sign once and apply it to the whole magnitude: the sign lives only
	// on the whole part, so computing it per-part would ADD the fractional cents for
	// a negative value (e.g. "-5.50" → -450 instead of -550). Mirrors fromCents,
	// keeping the two helpers exact inverses across negatives.
	const negative = price.trim().startsWith("-");
	const [whole = "0", frac = "0"] = price.replace("-", "").split(".");
	const paddedFrac = frac.padEnd(2, "0").slice(0, 2);
	const magnitude = parseInt(whole, 10) * 100 + parseInt(paddedFrac, 10);
	return negative ? -magnitude : magnitude;
}

/**
 * Converts integer cents back to a decimal string with 2 decimals.
 */
export function fromCents(cents: number): string {
	const sign = cents < 0 ? "-" : "";
	const abs = Math.abs(cents);
	const whole = Math.floor(abs / 100);
	const frac = abs % 100;
	return `${sign}${whole}.${frac.toString().padStart(2, "0")}`;
}
