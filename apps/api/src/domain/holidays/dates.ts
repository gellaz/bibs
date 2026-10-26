/** Parse "YYYY-MM-DD" into a UTC Date (calendar-only, no tz semantics). */
function parseUTC(ymd: string): Date {
	const [y, m, d] = ymd.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC Date back to "YYYY-MM-DD". */
function fmtUTC(date: Date): string {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, "0");
	const d = String(date.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** Build "YYYY-MM-DD" from numeric parts. */
export function makeYMD(year: number, month: number, day: number): string {
	return fmtUTC(new Date(Date.UTC(year, month - 1, day)));
}

/** Day of week, 0=Monday … 6=Sunday (repo convention). */
export function dowFromYMD(ymd: string): number {
	return (parseUTC(ymd).getUTCDay() + 6) % 7;
}

/** Add (or subtract) whole days to a calendar date. */
export function addDaysYMD(ymd: string, days: number): string {
	const d = parseUTC(ymd);
	d.setUTCDate(d.getUTCDate() + days);
	return fmtUTC(d);
}

/** Inclusive list of dates from start to end (end omitted = single day). */
export function expandRange(start: string, end?: string | null): string[] {
	const last = end ?? start;
	if (last < start) return [];
	const out: string[] = [];
	for (let cur = start; cur <= last; cur = addDaysYMD(cur, 1)) out.push(cur);
	return out;
}

/** Year component of "YYYY-MM-DD". */
export function ymdToYear(ymd: string): number {
	return Number(ymd.slice(0, 4));
}
