import { FormatRegistry } from "@sinclair/typebox";

/**
 * `format: "calendar-date"`: an RFC 3339 full-date (YYYY-MM-DD) that exists on
 * the calendar. Not Elysia's `date`: that one is lenient (`2024-02-30` passes,
 * because `new Date()` rolls it over to 1 March), and it is registered
 * first-come, so a stricter `date` of ours would silently lose on the API.
 * A name of our own is set unconditionally and means the same thing on the
 * API and in the seller forms, which compile these schemas with TypeCompiler.
 */
const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isCalendarDate(value: string): boolean {
	const m = FULL_DATE.exec(value);
	if (!m) return false;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	if (month < 1 || month > 12 || day < 1) return false;
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const max = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
	return day <= max;
}

FormatRegistry.Set("calendar-date", isCalendarDate);
