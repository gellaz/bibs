interface TimeSlot {
	open: string;
	close: string;
}

interface DaySchedule {
	dayOfWeek: number;
	slots: TimeSlot[];
}

/**
 * Valida la coerenza semantica degli orari di apertura (il FORMATO HH:mm e i
 * range di dayOfWeek sono già garantiti dallo schema TypeBox a monte):
 * - chiusura strettamente successiva all'apertura per ogni fascia;
 * - nessuna sovrapposizione tra fasce dello stesso giorno (il confine
 *   close == open della successiva è ammesso: close è esclusivo in getOpenStatus);
 * - nessun giorno duplicato.
 * Convenzione: 0 = lunedì … 6 = domenica. Le stringhe HH:mm zero-padded si
 * confrontano correttamente in ordine lessicografico.
 * Ritorna un messaggio d'errore (italiano, per ServiceError) o null se valido.
 */
export function validateOpeningHours(hours: DaySchedule[]): string | null {
	const seenDays = new Set<number>();
	for (const day of hours) {
		if (seenDays.has(day.dayOfWeek))
			return `Giorno duplicato negli orari (dayOfWeek ${day.dayOfWeek})`;
		seenDays.add(day.dayOfWeek);

		const sorted = [...day.slots].sort((a, b) => (a.open < b.open ? -1 : 1));
		for (const slot of sorted) {
			if (slot.close <= slot.open)
				return `L'orario di chiusura (${slot.close}) deve essere successivo all'apertura (${slot.open})`;
		}
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i].open < sorted[i - 1].close)
				return `Le fasce orarie ${sorted[i - 1].open}-${sorted[i - 1].close} e ${sorted[i].open}-${sorted[i].close} si sovrappongono`;
		}
	}
	return null;
}
