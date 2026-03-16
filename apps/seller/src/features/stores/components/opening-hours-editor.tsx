import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { ClockIcon, PlusCircleIcon, XIcon } from "lucide-react";
import { useCallback } from "react";

const DAY_LABELS = [
	"Lunedì",
	"Martedì",
	"Mercoledì",
	"Giovedì",
	"Venerdì",
	"Sabato",
	"Domenica",
] as const;

interface TimeSlot {
	open: string;
	close: string;
}

interface DaySchedule {
	dayOfWeek: number;
	slots: TimeSlot[];
}

export interface OpeningHoursEditorProps {
	value: DaySchedule[];
	onChange: (value: DaySchedule[]) => void;
}

const DEFAULT_WEEKDAY_SLOTS: TimeSlot[] = [
	{ open: "09:00", close: "13:00" },
	{ open: "14:30", close: "19:00" },
];

/** Default opening hours: Mon–Sat 9–13 / 14:30–19, Sunday closed. */
export const DEFAULT_OPENING_HOURS: DaySchedule[] = Array.from(
	{ length: 6 },
	(_, i) => ({
		dayOfWeek: i,
		slots: DEFAULT_WEEKDAY_SLOTS.map((s) => ({ ...s })),
	}),
);

export function OpeningHoursEditor({
	value,
	onChange,
}: OpeningHoursEditorProps) {
	const getDaySchedule = useCallback(
		(dayOfWeek: number) => value.find((d) => d.dayOfWeek === dayOfWeek),
		[value],
	);

	const toggleDay = useCallback(
		(dayOfWeek: number, enabled: boolean) => {
			if (enabled) {
				const slots =
					dayOfWeek === 6
						? [{ open: "09:00", close: "13:00" }]
						: DEFAULT_WEEKDAY_SLOTS.map((s) => ({ ...s }));
				onChange(
					[...value, { dayOfWeek, slots }].sort(
						(a, b) => a.dayOfWeek - b.dayOfWeek,
					),
				);
			} else {
				onChange(value.filter((d) => d.dayOfWeek !== dayOfWeek));
			}
		},
		[value, onChange],
	);

	const updateSlot = useCallback(
		(
			dayOfWeek: number,
			slotIndex: number,
			field: keyof TimeSlot,
			val: string,
		) => {
			onChange(
				value.map((d) =>
					d.dayOfWeek === dayOfWeek
						? {
								...d,
								slots: d.slots.map((s, i) =>
									i === slotIndex ? { ...s, [field]: val } : s,
								),
							}
						: d,
				),
			);
		},
		[value, onChange],
	);

	const addSlot = useCallback(
		(dayOfWeek: number) => {
			onChange(
				value.map((d) =>
					d.dayOfWeek === dayOfWeek
						? {
								...d,
								slots: [...d.slots, { open: "14:00", close: "18:00" }],
							}
						: d,
				),
			);
		},
		[value, onChange],
	);

	const removeSlot = useCallback(
		(dayOfWeek: number, slotIndex: number) => {
			onChange(
				value.map((d) =>
					d.dayOfWeek === dayOfWeek
						? { ...d, slots: d.slots.filter((_, i) => i !== slotIndex) }
						: d,
				),
			);
		},
		[value, onChange],
	);

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<ClockIcon className="size-4 text-muted-foreground" />
				<Label className="text-sm font-medium">Orari di apertura</Label>
			</div>

			<div className="divide-y rounded-lg border">
				{DAY_LABELS.map((dayLabel, dayOfWeek) => {
					const schedule = getDaySchedule(dayOfWeek);
					const isActive = !!schedule;

					return (
						<div
							key={dayOfWeek}
							className={`px-3 py-2.5 lg:py-2 transition-colors ${
								isActive ? "bg-background" : "bg-muted/30"
							}`}
						>
							<div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3">
								{/* Badge + day name */}
								<div className="flex items-center gap-2.5 shrink-0">
									<button
										type="button"
										onClick={() => toggleDay(dayOfWeek, !isActive)}
										className={`inline-flex w-14 justify-center items-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold transition-all duration-200 ease-in-out ${
											isActive
												? "border-emerald-500/50 text-emerald-600 hover:border-emerald-500 hover:bg-emerald-50 dark:border-emerald-400/50 dark:text-emerald-400 dark:hover:border-emerald-400 dark:hover:bg-emerald-950/30"
												: "border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
										}`}
									>
										{isActive ? "Aperto" : "Chiuso"}
									</button>

									<span className="w-20 text-sm font-semibold">{dayLabel}</span>
								</div>

								{/* Time slots */}
								{isActive && (
									<div className="flex flex-col lg:flex-row lg:flex-wrap gap-2 lg:gap-3 pl-16.5 lg:pl-0">
										{schedule.slots.map((slot, slotIndex) => (
											<div
												key={slotIndex}
												className="flex items-center gap-1.5"
											>
												<span className="text-xs text-muted-foreground w-12 shrink-0 lg:hidden">
													Dalle
												</span>
												<Input
													type="time"
													value={slot.open}
													onChange={(e) =>
														updateSlot(
															dayOfWeek,
															slotIndex,
															"open",
															e.target.value,
														)
													}
													className="h-7 w-28 lg:w-24 text-sm tabular-nums"
												/>
												<span className="text-xs text-muted-foreground shrink-0 text-center lg:hidden w-8">
													alle
												</span>
												<span className="hidden lg:inline text-xs text-muted-foreground">
													–
												</span>
												<Input
													type="time"
													value={slot.close}
													onChange={(e) =>
														updateSlot(
															dayOfWeek,
															slotIndex,
															"close",
															e.target.value,
														)
													}
													className="h-7 w-28 lg:w-24 text-sm tabular-nums"
												/>
												{schedule.slots.length > 1 && (
													<button
														type="button"
														onClick={() => removeSlot(dayOfWeek, slotIndex)}
														className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
														title="Rimuovi fascia"
													>
														<XIcon className="size-3.5" />
													</button>
												)}
											</div>
										))}
									</div>
								)}

								<div className="flex-1" />

								{isActive && schedule.slots.length < 4 && (
									<button
										type="button"
										onClick={() => addSlot(dayOfWeek)}
										className="flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors shrink-0 self-start lg:self-auto ml-16.5 lg:ml-0"
									>
										<PlusCircleIcon className="size-3.5" />
										Aggiungi fascia
									</button>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
