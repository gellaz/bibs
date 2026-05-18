type Slot = { open: string; close: string };
type DaySchedule = { dayOfWeek: number; slots: Slot[] };

export type OpenState =
	| { status: "open"; closesAt: string }
	| {
			status: "closed";
			nextOpen: {
				day: number;
				time: string;
				isToday: boolean;
				isTomorrow: boolean;
			} | null;
	  }
	| { status: "no-hours" };

const WEEKDAYS_IT = [
	"lunedì",
	"martedì",
	"mercoledì",
	"giovedì",
	"venerdì",
	"sabato",
	"domenica",
] as const;

function jsToBibsDay(jsDay: number): number {
	return (jsDay + 6) % 7;
}

function toMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
}

export function getOpenState(
	openingHours: DaySchedule[] | null | undefined,
	now: Date = new Date(),
): OpenState {
	if (!openingHours || openingHours.length === 0) {
		return { status: "no-hours" };
	}

	const today = jsToBibsDay(now.getDay());
	const minutesNow = now.getHours() * 60 + now.getMinutes();

	const todaySchedule = openingHours.find((d) => d.dayOfWeek === today);
	if (todaySchedule) {
		for (const slot of todaySchedule.slots) {
			const open = toMinutes(slot.open);
			const close = toMinutes(slot.close);
			if (open <= minutesNow && minutesNow < close) {
				return { status: "open", closesAt: slot.close };
			}
		}
	}

	for (let offset = 0; offset < 7; offset++) {
		const day = (today + offset) % 7;
		const schedule = openingHours.find((d) => d.dayOfWeek === day);
		if (!schedule) continue;
		for (const slot of schedule.slots) {
			const open = toMinutes(slot.open);
			if (offset === 0 && open <= minutesNow) continue;
			return {
				status: "closed",
				nextOpen: {
					day,
					time: slot.open,
					isToday: offset === 0,
					isTomorrow: offset === 1,
				},
			};
		}
	}

	return { status: "closed", nextOpen: null };
}

export function formatOpenState(state: OpenState): string {
	if (state.status === "open") return `Aperto · chiude alle ${state.closesAt}`;
	if (state.status === "no-hours") return "Orari non impostati";
	if (!state.nextOpen) return "Chiuso";
	const { day, time, isToday, isTomorrow } = state.nextOpen;
	if (isToday) return `Chiuso · apre alle ${time}`;
	if (isTomorrow) return `Chiuso · apre domani alle ${time}`;
	return `Chiuso · apre ${WEEKDAYS_IT[day]} alle ${time}`;
}
