import { m } from "@/paraglide/messages";
import type { DaySchedule } from "../components/opening-hours-editor";

/**
 * Mirror client-side del validator API (apps/api/src/lib/opening-hours.ts).
 * Ritorna una mappa dayOfWeek → messaggio per il rendering inline per-giorno.
 * HH:mm zero-padded: il confronto lessicografico è quello cronologico.
 */
export function validateOpeningHours(
	hours: DaySchedule[],
): Record<number, string> {
	const errors: Record<number, string> = {};
	for (const day of hours) {
		const sorted = [...day.slots].sort((a, b) => (a.open < b.open ? -1 : 1));
		for (const slot of sorted) {
			if (slot.close <= slot.open) {
				errors[day.dayOfWeek] = m["store.form.hours_invalid_slot"]();
				break;
			}
		}
		if (errors[day.dayOfWeek]) continue;
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i].open < sorted[i - 1].close) {
				errors[day.dayOfWeek] = m["store.form.hours_overlap"]();
				break;
			}
		}
	}
	return errors;
}
