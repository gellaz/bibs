/**
 * Converts a decimal string (e.g. "9.99") to integer cents (999).
 * Avoids floating-point arithmetic errors.
 */
export function toCents(price: string): number {
	const [whole = "0", frac = "0"] = price.split(".");
	const paddedFrac = frac.padEnd(2, "0").slice(0, 2);
	return parseInt(whole, 10) * 100 + parseInt(paddedFrac, 10);
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
