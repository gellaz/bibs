// Gemelli dei limiti di `config.reservationHours` nell'API (1–72).
export const RESERVATION_HOURS_MIN = 1;
export const RESERVATION_HOURS_MAX = 72;

/** Ore di ritiro digitate dal seller: intero da 1 a 72, altrimenti null. */
export function parseReservationHours(raw: string): number | null {
	if (!/^\d+$/.test(raw.trim())) return null;
	const n = Number(raw.trim());
	return n >= RESERVATION_HOURS_MIN && n <= RESERVATION_HOURS_MAX ? n : null;
}
