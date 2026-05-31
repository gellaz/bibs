import { addDaysYMD, dowFromYMD } from "./dates";
import type { OpeningHoursDay, OpenStatus } from "./types";

const MAX_LOOKAHEAD_DAYS = 60;

/** Current Europe/Rome calendar date + minutes-since-midnight. */
function nowInRome(now: Date): { date: string; minutes: number } {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Europe/Rome",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(now);
	const get = (type: string) =>
		parts.find((p) => p.type === type)?.value ?? "00";
	const date = `${get("year")}-${get("month")}-${get("day")}`;
	const minutes = Number(get("hour")) * 60 + Number(get("minute"));
	return { date, minutes };
}

const toMinutes = (hhmm: string): number => {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
};

/** Slots for a weekday, sorted by opening time. */
function slotsFor(
	openingHours: OpeningHoursDay[] | null,
	dow: number,
): Array<{ open: string; close: string }> {
	const day = openingHours?.find((d) => d.dayOfWeek === dow);
	if (!day) return [];
	return [...day.slots].sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
}

export function getOpenStatus(input: {
	openingHours: OpeningHoursDay[] | null;
	closedDates: Set<string>;
	now: Date;
}): OpenStatus {
	const { openingHours, closedDates } = input;
	const { date: today, minutes } = nowInRome(input.now);
	const closedToday = closedDates.has(today);

	// Currently open? (never when today is a closure date)
	if (!closedToday) {
		for (const s of slotsFor(openingHours, dowFromYMD(today))) {
			if (minutes >= toMinutes(s.open) && minutes < toMinutes(s.close)) {
				return { isOpen: true, status: "open", closesAt: s.close };
			}
		}
	}

	const status = closedToday ? "closed_holiday" : "closed";

	// Find the next opening.
	for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset++) {
		const date = addDaysYMD(today, offset);
		if (closedDates.has(date)) continue;
		for (const s of slotsFor(openingHours, dowFromYMD(date))) {
			if (offset === 0 && toMinutes(s.open) <= minutes) continue; // already passed
			return { isOpen: false, status, opensAt: { date, time: s.open } };
		}
	}

	return { isOpen: false, status };
}
