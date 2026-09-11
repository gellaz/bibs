import { m } from "@/paraglide/messages";
import {
	type DayLabels,
	formatWeeklyHours,
	type OpeningHoursDayInput,
	romeDayOfWeek,
} from "./format-opening-hours";

/**
 * Settimana di apertura. Vive in una colonna da ~300px: le fasce si impilano
 * una per riga invece di andare a capo in mezzo a "09:00–13:00 ·", e il giorno
 * corrente è marcato da fondo + peso (mai dal solo colore).
 */
export function OpeningHours({
	openingHours,
}: {
	openingHours: OpeningHoursDayInput[] | null;
}) {
	const dayLabels: DayLabels = [
		m.day_monday(),
		m.day_tuesday(),
		m.day_wednesday(),
		m.day_thursday(),
		m.day_friday(),
		m.day_saturday(),
		m.day_sunday(),
	];
	const rows = formatWeeklyHours(
		openingHours,
		romeDayOfWeek(new Date()),
		dayLabels,
	);
	return (
		<dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">
			{rows.map((r) => (
				<div
					key={r.dayOfWeek}
					className={`flex items-baseline justify-between gap-3 px-3 py-1.5 text-[0.8125rem] ${
						r.isToday ? "bg-muted/60 font-medium" : ""
					}`}
				>
					<dt className="text-foreground">{r.label}</dt>
					<dd
						className={`flex flex-wrap justify-end gap-x-2 gap-y-0.5 tabular-nums ${
							r.slots.length > 0 ? "text-foreground" : "text-muted-foreground"
						}`}
					>
						{r.slots.length > 0 ? (
							r.slots.map((slot) => (
								<span key={slot} className="whitespace-nowrap">
									{slot}
								</span>
							))
						) : (
							<span>{m.store_closed()}</span>
						)}
					</dd>
				</div>
			))}
		</dl>
	);
}
