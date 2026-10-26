import { toYMD } from "@bibs/ui/lib/date";

/** Scadenza «se confermi adesso» di un negozio, dall'API. */
export type ReservationInfo = {
	hours: number;
	expiresAt: Date | string;
	clock: "opening" | "calendar";
};

/** Quale frase va sotto le scadenze del riepilogo: mai «ore di apertura» per un negozio senza orari. */
export function reserveNoteKind(
	clocks: ReservationInfo["clock"][],
): "opening" | "mixed" | "calendar" {
	const opening = clocks.filter((c) => c === "opening").length;
	if (opening === 0) return "calendar";
	return opening === clocks.length ? "opening" : "mixed";
}

// "YYYY-MM-DD HH:mm" a Roma, confrontabile come stringa con opensAt.
const romeStamp = (d: Date | string) =>
	new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Europe/Rome",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(new Date(d));

/**
 * Riapertura da mostrare sotto il timer quando il negozio adesso è chiuso:
 * solo se la prenotazione è aperta e il negozio riapre prima della scadenza,
 * altrimenti la frase «contano solo le ore di apertura» sarebbe falsa.
 */
export function closedNoteOpensAt(input: {
	open: boolean;
	expiresAt: Date | string;
	openStatus?: {
		status: string;
		opensAt?: { date: Date | string; time: string };
	} | null;
}): { date: string; time: string } | null {
	const s = input.openStatus;
	if (!input.open || !s?.opensAt) return null;
	if (s.status !== "closed" && s.status !== "closed_holiday") return null;
	// Il client di prima idratava in Date anche le date "YYYY-MM-DD".
	const date = toYMD(s.opensAt.date);
	const opens = `${date} ${s.opensAt.time}`;
	return opens < romeStamp(input.expiresAt)
		? { date, time: s.opensAt.time }
		: null;
}
