/**
 * Coerce an API date field to a "YYYY-MM-DD" string.
 *
 * Eden Treaty rehydrates ISO-date-looking response strings into `Date` objects
 * (date-only values like "2026-01-01" become UTC-midnight `Date`s), even when
 * the TypeBox schema declares `t.String()`. Rendering such a value directly
 * throws "Objects are not valid as a React child (found: [object Date])". Run
 * every API calendar-date through this at the use site.
 *
 * UTC parts are used so the original calendar day is recovered regardless of
 * the viewer's timezone (Eden parsed the date-only string as UTC midnight).
 */
export function toYMD(value: string | Date): string {
	if (value instanceof Date) {
		const y = value.getUTCFullYear();
		const m = String(value.getUTCMonth() + 1).padStart(2, "0");
		const d = String(value.getUTCDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}
	return value.slice(0, 10);
}
