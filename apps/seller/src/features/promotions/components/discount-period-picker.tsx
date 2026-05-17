import { Label } from "@bibs/ui/components/label";
import { Switch } from "@bibs/ui/components/switch";
import {
	DateRangePicker,
	type DateRangePreset,
} from "@/components/date-range-picker";
import { m } from "@/paraglide/messages";

interface Props {
	startsAt: string;
	endsAt: string;
	noEndDate: boolean;
	disableStartsAt?: boolean;
	disabled?: boolean;
	onChange: (next: {
		startsAt: string;
		endsAt: string;
		noEndDate: boolean;
	}) => void;
	error?: string;
}

function parseLocal(s: string): Date | undefined {
	if (!s) return undefined;
	const d = new Date(s);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

function toLocal(d: Date): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
		d.getHours(),
	)}:${pad(d.getMinutes())}`;
}

function endOfDay(d: Date): Date {
	const c = new Date(d);
	c.setHours(23, 59, 0, 0);
	return c;
}

export function DiscountPeriodPicker({
	startsAt,
	endsAt,
	noEndDate,
	disableStartsAt,
	disabled,
	onChange,
	error,
}: Props) {
	const from = parseLocal(startsAt);
	const to = noEndDate ? undefined : parseLocal(endsAt);

	const editMode = noEndDate
		? ("from-only" as const)
		: disableStartsAt
			? ("to-only" as const)
			: ("range" as const);

	const presets: DateRangePreset[] = [
		{
			label: m.promotions_form_period_preset_week(),
			apply: ({ from }) => {
				const base = from ?? new Date();
				const end = new Date(base);
				end.setDate(end.getDate() + 7);
				return { from: base, to: endOfDay(end) };
			},
		},
		{
			label: m.promotions_form_period_preset_month(),
			apply: ({ from }) => {
				const base = from ?? new Date();
				const end = new Date(base);
				end.setDate(end.getDate() + 30);
				return { from: base, to: endOfDay(end) };
			},
		},
		{
			label: m.promotions_form_period_preset_eom(),
			apply: ({ from }) => {
				const base = from ?? new Date();
				const end = new Date(
					base.getFullYear(),
					base.getMonth() + 1,
					0,
					23,
					59,
				);
				return { from: base, to: end };
			},
		},
	];

	function handleRangeChange(range: {
		from: Date | undefined;
		to: Date | undefined;
	}) {
		const nextStartsAt = range.from ? toLocal(range.from) : "";
		const nextEndsAt = range.to ? toLocal(endOfDay(range.to)) : "";
		const nextNoEndDate = range.to ? false : noEndDate;
		onChange({
			startsAt: nextStartsAt || startsAt,
			endsAt: nextEndsAt,
			noEndDate: nextNoEndDate,
		});
	}

	function toggleNoEnd(v: boolean) {
		onChange({
			startsAt,
			endsAt: v ? "" : endsAt,
			noEndDate: v,
		});
	}

	return (
		<div className="space-y-2">
			<Label>{m.promotions_form_period_label()}</Label>
			<div className="flex flex-wrap items-center gap-3">
				<DateRangePicker
					from={from}
					to={to}
					onChange={handleRangeChange}
					editMode={editMode}
					presets={presets}
					disabled={disabled}
					disableBefore={
						disableStartsAt && from
							? new Date(from.getTime() + 24 * 3600 * 1000)
							: undefined
					}
					placeholder={m.promotions_form_period_trigger_empty()}
					openEnded={noEndDate}
					openEndedShortLabel={m.promotions_form_period_no_end_short()}
					numberOfMonths={2}
					className="min-w-[14rem]"
				/>
				<div className="flex items-center gap-2">
					<Label htmlFor="period-no-end" className="cursor-pointer">
						{m.promotions_form_period_no_end()}
					</Label>
					<Switch
						id="period-no-end"
						checked={noEndDate}
						onCheckedChange={toggleNoEnd}
						disabled={disabled || disableStartsAt}
					/>
				</div>
			</div>
			{error && <p className="text-destructive text-sm">{error}</p>}
		</div>
	);
}
