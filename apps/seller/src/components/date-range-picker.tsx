import { Button } from "@bibs/ui/components/button";
import { Calendar } from "@bibs/ui/components/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@bibs/ui/components/popover";
import { cn } from "@bibs/ui/lib/utils";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

type DateRange = { from: Date | undefined; to?: Date | undefined };

export type DateRangeEditMode = "range" | "from-only" | "to-only";

export interface DateRangePreset {
	label: string;
	apply: (current: { from: Date | undefined; to: Date | undefined }) => {
		from: Date | undefined;
		to: Date | undefined;
	};
}

export interface DateRangePickerProps {
	from: Date | undefined;
	to: Date | undefined;
	onChange: (range: { from: Date | undefined; to: Date | undefined }) => void;
	editMode?: DateRangeEditMode;
	presets?: DateRangePreset[];
	disabled?: boolean;
	disableBefore?: Date;
	placeholder?: string;
	openEnded?: boolean;
	openEndedShortLabel?: string;
	numberOfMonths?: number;
	className?: string;
}

function formatShort(d: Date | undefined): string {
	if (!d) return "";
	return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export function DateRangePicker({
	from,
	to,
	onChange,
	editMode = "range",
	presets,
	disabled,
	disableBefore,
	placeholder = "Seleziona periodo",
	openEnded = false,
	openEndedShortLabel = "senza fine",
	numberOfMonths = 2,
	className,
}: DateRangePickerProps) {
	const [open, setOpen] = useState(false);

	const triggerLabel = (() => {
		if (!from) return placeholder;
		const fromLabel = formatShort(from);
		if (openEnded) return `${fromLabel} → ${openEndedShortLabel}`;
		if (!to) return `${fromLabel} → …`;
		return `${fromLabel} → ${formatShort(to)}`;
	})();

	const disabledMatcher = disableBefore ? { before: disableBefore } : undefined;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					disabled={disabled}
					className={cn(
						"justify-start font-normal",
						!from && "text-muted-foreground",
						className,
					)}
				>
					<CalendarIcon className="mr-2 size-4" />
					{triggerLabel}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				{editMode === "from-only" ? (
					<Calendar
						mode="single"
						defaultMonth={from ?? new Date()}
						selected={from}
						onSelect={(d) => onChange({ from: d, to: undefined })}
						disabled={disabledMatcher}
						numberOfMonths={1}
					/>
				) : editMode === "to-only" ? (
					<Calendar
						mode="single"
						defaultMonth={to ?? from ?? new Date()}
						selected={to}
						onSelect={(d) => onChange({ from, to: d })}
						disabled={disabledMatcher}
						numberOfMonths={1}
					/>
				) : (
					<Calendar
						mode="range"
						defaultMonth={from ?? new Date()}
						selected={from ? ({ from, to } as DateRange) : undefined}
						onSelect={(range) => {
							if (!range?.from) {
								onChange({ from: undefined, to: undefined });
								return;
							}
							onChange({ from: range.from, to: range.to });
						}}
						disabled={disabledMatcher}
						numberOfMonths={numberOfMonths}
					/>
				)}

				{editMode === "range" && presets && presets.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5 border-t p-2.5">
						{presets.map((p) => (
							<button
								key={p.label}
								type="button"
								onClick={() => {
									const next = p.apply({ from, to });
									onChange(next);
								}}
								className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground"
							>
								{p.label}
							</button>
						))}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
