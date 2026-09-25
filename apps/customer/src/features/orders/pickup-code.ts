/** Codice di ritiro raggruppato 3-3 (`K7X M4P`), da leggere a voce al banco. */
export function formatPickupCode(code: string | null | undefined): string {
	return code ? `${code.slice(0, 3)} ${code.slice(3)}` : "";
}
