import { addDaysYMD, expandRange, makeYMD, ymdToYear } from "./dates";
import { computeEaster } from "./easter";
import type { CustomClosure, HolidayDef } from "./types";

/** All concrete dates a single definition falls on, across [fromYear, toYear]. */
export function resolveOccurrences(
	def: HolidayDef,
	fromYear: number,
	toYear: number,
): string[] {
	if (def.type === "one_off") {
		if (!def.oneOffDate) return [];
		const y = ymdToYear(def.oneOffDate);
		return y >= fromYear && y <= toYear ? [def.oneOffDate] : [];
	}

	const out: string[] = [];
	for (let year = fromYear; year <= toYear; year++) {
		if (def.type === "fixed") {
			if (def.month == null || def.day == null) continue;
			out.push(makeYMD(year, def.month, def.day));
		} else {
			// easter_relative
			if (def.easterOffsetDays == null) continue;
			const e = computeEaster(year);
			out.push(addDaysYMD(makeYMD(year, e.month, e.day), def.easterOffsetDays));
		}
	}
	return out;
}

/** Set of closed calendar dates for a store within [from, to]. */
export function resolveStoreClosedDates(
	input: {
		activeDefs: HolidayDef[];
		optOutIds: string[];
		customClosures: CustomClosure[];
	},
	window: { from: string; to: string },
): Set<string> {
	const optedOut = new Set(input.optOutIds);
	const fromYear = ymdToYear(window.from);
	const toYear = ymdToYear(window.to);
	const closed = new Set<string>();

	for (const def of input.activeDefs) {
		if (optedOut.has(def.id)) continue;
		for (const ymd of resolveOccurrences(def, fromYear, toYear)) {
			if (ymd >= window.from && ymd <= window.to) closed.add(ymd);
		}
	}

	for (const c of input.customClosures) {
		for (const ymd of expandRange(c.startDate, c.endDate)) {
			if (ymd >= window.from && ymd <= window.to) closed.add(ymd);
		}
	}

	return closed;
}
