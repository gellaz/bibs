// Date sempre come stringhe YYYY-MM-DD: il confronto lessicografico è quello
// cronologico, e nessun fuso orario sposta un giorno.

export interface HolidayRow {
	definitionId: string;
	name: string;
	type: "fixed" | "easter_relative" | "one_off";
	nextDate: string | null;
	observed: boolean;
}

export interface CustomClosure {
	startDate: string;
	endDate?: string;
	note?: string;
}

/** Ciò che il seller modifica: le festività in cui resta aperto e le sue chiusure. */
export interface ClosuresDraft {
	optOutIds: string[];
	customClosures: CustomClosure[];
}

export type ClosureRow =
	| {
			kind: "holiday";
			key: string;
			definitionId: string;
			name: string;
			start: string | null;
			closed: boolean;
	  }
	| {
			kind: "custom";
			key: string;
			index: number;
			name: string | null;
			start: string;
			end?: string;
	  };

/** Oggi a Roma, dove stanno i negozi. */
export function romeToday(): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(
		new Date(),
	);
}

/** Le chiusure già finite non si mostrano, ma il PUT le rimanda intatte. */
export function splitCustomClosures(all: CustomClosure[], today: string) {
	const past: CustomClosure[] = [];
	const upcoming: CustomClosure[] = [];
	for (const c of all) {
		((c.endDate ?? c.startDate) < today ? past : upcoming).push(c);
	}
	return { past, upcoming };
}

/** Festività e chiusure del negozio in una lista sola, in ordine di data. */
export function closureRows(
	holidays: HolidayRow[],
	draft: ClosuresDraft,
): ClosureRow[] {
	const rows: ClosureRow[] = [
		...holidays.map(
			(h): ClosureRow => ({
				kind: "holiday",
				key: `h-${h.definitionId}`,
				definitionId: h.definitionId,
				name: h.name,
				start: h.nextDate,
				closed: !draft.optOutIds.includes(h.definitionId),
			}),
		),
		...draft.customClosures.map(
			(c, index): ClosureRow => ({
				kind: "custom",
				key: `c-${index}-${c.startDate}`,
				index,
				name: c.note?.trim() || null,
				start: c.startDate,
				end: c.endDate,
			}),
		),
	];
	// Senza data in fondo; a parità di data la festività prima.
	return rows.sort((a, b) => {
		if (a.start === b.start)
			return a.kind === b.kind ? 0 : a.kind === "holiday" ? -1 : 1;
		if (a.start === null) return 1;
		if (b.start === null) return -1;
		return a.start.localeCompare(b.start);
	});
}

const dayNumber = (ymd: string) => {
	const [y, m, d] = ymd.split("-").map(Number);
	return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Giorni di chiusura, estremi compresi. */
export function closureDays(start: string, end?: string): number {
	return end ? dayNumber(end) - dayNumber(start) + 1 : 1;
}

/** Forma canonica per capire se la bozza è cambiata, a prescindere dall'ordine. */
export function serializeClosures(draft: ClosuresDraft): string {
	return JSON.stringify({
		opt: [...draft.optOutIds].sort(),
		custom: draft.customClosures
			.map((c) => ({ s: c.startDate, e: c.endDate ?? null, n: c.note ?? "" }))
			.sort(
				(a, b) =>
					a.s.localeCompare(b.s) || (a.e ?? "").localeCompare(b.e ?? ""),
			),
	});
}

/** La chiusura scritta nel modulo «Aggiungi chiusura», non ancora aggiunta. */
export interface PendingClosure {
	start: string;
	end: string;
	note: string;
}

/**
 * Bozza → chiusura, o null se non lo è ancora (senza Dal, o Al prima di Dal).
 * Il Salva del pannello la include: chi la scrive e salva senza «Aggiungi» non
 * la perde.
 */
export function pendingToClosure(
	pending: PendingClosure | null,
): CustomClosure | null {
	if (!pending?.start || (pending.end && pending.end < pending.start)) {
		return null;
	}
	return {
		startDate: pending.start,
		endDate:
			pending.end && pending.end !== pending.start ? pending.end : undefined,
		note: pending.note.trim() || undefined,
	};
}
