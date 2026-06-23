import {
	formatWeeklyHours,
	type OpeningHoursDayInput,
	romeDayOfWeek,
} from "./format-opening-hours";

export function OpeningHours({
	openingHours,
}: {
	openingHours: OpeningHoursDayInput[] | null;
}) {
	const rows = formatWeeklyHours(openingHours, romeDayOfWeek(new Date()));
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
						{r.hours ?? "Chiuso"}
					</dd>
				</div>
			))}
		</dl>
	);
}
