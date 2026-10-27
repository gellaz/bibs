import { addDaysYMD, dowFromYMD } from "./dates";
import {
	hasDeclaredHours,
	MAX_LOOKAHEAD_DAYS,
	nowInRome,
	slotsFor,
	toMinutes,
} from "./open-status";
import type { OpeningHoursDay } from "./types";

/** `opening` = contate le ore di apertura; `calendar` = ore di calendario. */
export type ReservationClock = "opening" | "calendar";

/** Ora di Roma (data + minuti dalla mezzanotte) → istante UTC, giusto anche al cambio d'ora. */
function romeWallToUtc(ymd: string, minutes: number): Date {
	const [y, mo, d] = ymd.split("-").map(Number);
	const wall = Date.UTC(y, mo - 1, d, 0, minutes);
	const offsetAt = (t: number) => {
		const { date, minutes: m } = nowInRome(new Date(t));
		const [yy, mm, dd] = date.split("-").map(Number);
		return Date.UTC(yy, mm - 1, dd, 0, m) - t;
	};
	const guess = wall - offsetAt(wall);
	return new Date(wall - offsetAt(guess));
}

/**
 * Scadenza di una prenotazione `reserve_pickup` fatta in `from`: si consumano
 * `hours` ore scorrendo le fasce di apertura dei giorni non chiusi (ora di
 * Roma, chiusura esclusiva come in getOpenStatus). Senza orari dichiarati il
 * tempo scorre sul calendario, perché non c'è altro su cui contare.
 */
export function reservationDeadline(input: {
	openingHours: OpeningHoursDay[] | null;
	closedDates: Set<string>;
	from: Date;
	hours: number;
}): { expiresAt: Date; clock: ReservationClock } {
	const { openingHours, closedDates, from, hours } = input;
	const calendar = {
		expiresAt: new Date(from.getTime() + hours * 3_600_000),
		clock: "calendar" as const,
	};
	if (!hasDeclaredHours(openingHours)) return calendar;

	const { date: today, minutes: nowMinutes } = nowInRome(from);
	let left = hours * 60;
	for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset++) {
		const date = addDaysYMD(today, offset);
		if (closedDates.has(date)) continue;
		for (const s of slotsFor(openingHours, dowFromYMD(date))) {
			const open = toMinutes(s.open);
			const start = offset === 0 ? Math.max(open, nowMinutes) : open;
			const end = toMinutes(s.close);
			if (start >= end) continue;
			if (end - start >= left)
				return {
					expiresAt: romeWallToUtc(date, start + left),
					clock: "opening",
				};
			left -= end - start;
		}
	}
	// ponytail: chiusure oltre 60 giorni → ore di calendario; allargare la finestra se capita davvero.
	return calendar;
}
