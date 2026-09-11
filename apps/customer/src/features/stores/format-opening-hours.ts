export interface OpeningHoursDayInput {
	dayOfWeek: number; // 0=Lun..6=Dom
	slots: { open: string; close: string }[];
}

export interface WeekRow {
	dayOfWeek: number;
	label: string;
	/** "09:00–13:00 · 16:00–19:00", or null when closed. */
	hours: string | null;
	/** The same slots unjoined ("09:00–13:00"), for narrow layouts that stack them. */
	slots: string[];
	isToday: boolean;
}

/** Etichette dei sette giorni, lunedì per primo. Le fornisce il chiamante:
 *  questo modulo resta puro e testabile senza il runtime i18n. */
export type DayLabels = readonly [
	string,
	string,
	string,
	string,
	string,
	string,
	string,
];

export function formatWeeklyHours(
	openingHours: OpeningHoursDayInput[] | null,
	todayDow: number,
	dayLabels: DayLabels,
): WeekRow[] {
	return dayLabels.map((label, dow) => {
		const day = openingHours?.find((d) => d.dayOfWeek === dow);
		const slots = day?.slots.map((s) => `${s.open}–${s.close}`) ?? [];
		return {
			dayOfWeek: dow,
			label,
			hours: slots.length > 0 ? slots.join(" · ") : null,
			slots,
			isToday: dow === todayDow,
		};
	});
}

/** Day of week 0=Lun..6=Dom in Europe/Rome for the given instant. */
export function romeDayOfWeek(now: Date): number {
	const weekday = new Intl.DateTimeFormat("en-US", {
		timeZone: "Europe/Rome",
		weekday: "short",
	}).format(now);
	const map: Record<string, number> = {
		Mon: 0,
		Tue: 1,
		Wed: 2,
		Thu: 3,
		Fri: 4,
		Sat: 5,
		Sun: 6,
	};
	return map[weekday] ?? 0;
}
