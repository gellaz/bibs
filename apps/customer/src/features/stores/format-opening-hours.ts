const DAY_LABELS = [
	"Lunedì",
	"Martedì",
	"Mercoledì",
	"Giovedì",
	"Venerdì",
	"Sabato",
	"Domenica",
] as const;

export interface OpeningHoursDayInput {
	dayOfWeek: number; // 0=Lun..6=Dom
	slots: { open: string; close: string }[];
}

export interface WeekRow {
	dayOfWeek: number;
	label: string;
	/** "09:00–13:00 · 16:00–19:00", or null when closed. */
	hours: string | null;
	isToday: boolean;
}

export function formatWeeklyHours(
	openingHours: OpeningHoursDayInput[] | null,
	todayDow: number,
): WeekRow[] {
	return DAY_LABELS.map((label, dow) => {
		const day = openingHours?.find((d) => d.dayOfWeek === dow);
		const hours =
			day && day.slots.length > 0
				? day.slots.map((s) => `${s.open}–${s.close}`).join(" · ")
				: null;
		return { dayOfWeek: dow, label, hours, isToday: dow === todayDow };
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
