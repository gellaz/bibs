import { m } from "@/paraglide/messages";
import {
	type DayLabels,
	formatWeeklyHours,
	type OpeningHoursDayInput,
	romeDayOfWeek,
} from "./format-opening-hours";

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
		<dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">
			{rows.map((r) => (
				<div
					key={r.dayOfWeek}
					className={`flex items-center justify-between px-4 py-2.5 text-sm ${
						r.isToday ? "bg-muted/60 font-medium" : ""
					}`}
				>
					<dt className="text-foreground">{r.label}</dt>
					<dd
						className={`tabular-nums ${r.hours ? "text-foreground" : "text-muted-foreground"}`}
					>
						{r.hours ?? m.store_closed()}
					</dd>
				</div>
			))}
		</dl>
	);
}
