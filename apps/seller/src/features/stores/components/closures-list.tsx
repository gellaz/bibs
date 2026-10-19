import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { ToggleGroup, ToggleGroupItem } from "@bibs/ui/components/toggle-group";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { cn } from "@bibs/ui/lib/utils";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { m } from "@/paraglide/messages";
import {
	type ClosuresDraft,
	closureDays,
	closureRows,
	type HolidayRow,
	romeToday,
} from "../lib/closure-rows";

// Segmento scelto pieno: a colpo d'occhio si vede se quel giorno sei chiuso o aperto.
const SEGMENT =
	"px-2.5 text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

const EMPTY_DRAFT = { start: "", end: "", note: "" };

function formatDay(ymd: string, opts: Intl.DateTimeFormatOptions): string {
	const [y, mo, d] = ymd.split("-").map(Number);
	return new Date(y, mo - 1, d).toLocaleDateString(intlLocale(), opts);
}

/**
 * Festività e chiusure del negozio in una lista sola, in ordine di data,
 * tutte visibili. Controllata: il salvataggio è del pannello che la contiene.
 */
export function ClosuresList({
	holidays,
	value,
	onChange,
}: {
	holidays: HolidayRow[];
	value: ClosuresDraft;
	onChange: (next: ClosuresDraft) => void;
}) {
	const [adding, setAdding] = useState(false);
	const [draft, setDraft] = useState(EMPTY_DRAFT);
	const rangeInvalid = !!draft.end && draft.end < draft.start;

	const add = () => {
		onChange({
			...value,
			customClosures: [
				...value.customClosures,
				{
					startDate: draft.start,
					endDate:
						draft.end && draft.end !== draft.start ? draft.end : undefined,
					note: draft.note.trim() || undefined,
				},
			],
		});
		setDraft(EMPTY_DRAFT);
		setAdding(false);
	};

	const setHolidayClosed = (definitionId: string, closed: boolean) =>
		onChange({
			...value,
			optOutIds: closed
				? value.optOutIds.filter((id) => id !== definitionId)
				: [...value.optOutIds, definitionId],
		});

	return (
		<div className="space-y-3">
			{adding ? (
				<div className="space-y-3 rounded-lg border border-border bg-card p-3">
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="closure-start">{m.store_closures_start()}</Label>
							<Input
								id="closure-start"
								type="date"
								min={romeToday()}
								value={draft.start}
								onChange={(e) => setDraft({ ...draft, start: e.target.value })}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="closure-end">{m.store_closures_end()}</Label>
							<Input
								id="closure-end"
								type="date"
								min={draft.start || undefined}
								value={draft.end}
								aria-invalid={rangeInvalid}
								onChange={(e) => setDraft({ ...draft, end: e.target.value })}
							/>
						</div>
					</div>
					<Input
						aria-label={m.store_closures_note_ph()}
						placeholder={m.store_closures_note_ph()}
						value={draft.note}
						onChange={(e) => setDraft({ ...draft, note: e.target.value })}
					/>
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setDraft(EMPTY_DRAFT);
								setAdding(false);
							}}
						>
							{m.common_cancel()}
						</Button>
						<Button
							type="button"
							size="sm"
							disabled={!draft.start || rangeInvalid}
							onClick={add}
						>
							{m.common_add()}
						</Button>
					</div>
				</div>
			) : (
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => setAdding(true)}
				>
					<PlusIcon />
					{m.store_closures_add()}
				</Button>
			)}

			<ul className="divide-y divide-border rounded-lg border border-border">
				{closureRows(holidays, value).map((row) => {
					const open = row.kind === "holiday" && !row.closed;
					const name = row.name ?? m.store_closures_unnamed();
					return (
						<li
							key={row.key}
							className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
						>
							<DateLabel
								start={row.start}
								end={row.kind === "custom" ? row.end : undefined}
								muted={open}
							/>
							<div className="min-w-0">
								<p
									className={cn(
										"truncate text-sm font-medium",
										open && "text-muted-foreground",
									)}
								>
									{name}
								</p>
								<p className="text-xs text-muted-foreground">
									{row.kind === "holiday"
										? row.closed
											? m.store_closures_kind_holiday()
											: m.store_closures_kind_holiday_open()
										: row.end
											? m.store_closures_kind_custom_days({
													count: closureDays(row.start, row.end),
												})
											: m.store_closures_kind_custom()}
								</p>
							</div>
							{row.kind === "holiday" ? (
								<ToggleGroup
									type="single"
									variant="outline"
									size="sm"
									value={row.closed ? "closed" : "open"}
									onValueChange={(v) =>
										v && setHolidayClosed(row.definitionId, v === "closed")
									}
									aria-label={m.store_closures_toggle_label({ name })}
								>
									<ToggleGroupItem value="closed" className={SEGMENT}>
										{m.store_closures_closed()}
									</ToggleGroupItem>
									<ToggleGroupItem value="open" className={SEGMENT}>
										{m.store_closures_open()}
									</ToggleGroupItem>
								</ToggleGroup>
							) : (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={`${m.store_closures_remove()} ${name}`}
									onClick={() =>
										onChange({
											...value,
											customClosures: value.customClosures.filter(
												(_, i) => i !== row.index,
											),
										})
									}
								>
									<Trash2Icon />
								</Button>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/** «1 nov» sopra il giorno della settimana; «7–9 gen» o «24 dic → 6 gen» per i periodi. */
function DateLabel({
	start,
	end,
	muted,
}: {
	start: string | null;
	end?: string;
	muted: boolean;
}) {
	if (!start) {
		return (
			<p className="text-sm text-muted-foreground">
				{m.store_closures_no_next()}
			</p>
		);
	}
	const sameMonth = end && start.slice(0, 7) === end.slice(0, 7);
	return (
		<div className={cn("leading-tight", muted && "opacity-60")}>
			<p className="text-sm font-semibold tabular-nums">
				{end && sameMonth
					? `${formatDay(start, { day: "numeric" })}–${formatDay(end, { day: "numeric", month: "short" })}`
					: formatDay(start, { day: "numeric", month: "short" })}
			</p>
			<p className="text-xs text-muted-foreground">
				{end && !sameMonth
					? `→ ${formatDay(end, { day: "numeric", month: "short" })}`
					: formatDay(start, { weekday: "long" })}
			</p>
		</div>
	);
}
