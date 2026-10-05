import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { zodResolver } from "@hookform/resolvers/zod";
import { type SubmitHandler, useForm } from "react-hook-form";
import {
	type HolidayFormData,
	holidayFormSchema,
	monthNames,
} from "@/features/holidays/schemas/holiday";
import { m } from "@/paraglide/messages";

interface HolidayFormProps {
	onSubmit: (data: HolidayFormData) => void;
	onCancel: () => void;
	isPending: boolean;
}

export function HolidayForm({
	onSubmit,
	onCancel,
	isPending,
}: HolidayFormProps) {
	const {
		register,
		handleSubmit,
		watch,
		formState: { errors },
	} = useForm<HolidayFormData>({
		resolver: zodResolver(holidayFormSchema),
		defaultValues: {
			type: "fixed",
			name: "",
			month: "",
			day: "",
			easterOffsetDays: "0",
			oneOffDate: "",
		},
	});

	const type = watch("type");
	const onFormSubmit: SubmitHandler<HolidayFormData> = (data) => onSubmit(data);

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="holiday-name">{m.common_name()}</FieldLabel>
					<Input
						id="holiday-name"
						placeholder={m.holidays_name_placeholder()}
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="holiday-type">{m.common_type()}</FieldLabel>
					<NativeSelect
						id="holiday-type"
						className="w-full"
						{...register("type")}
					>
						<NativeSelectOption value="fixed">
							{m.holidays_type_fixed()}
						</NativeSelectOption>
						<NativeSelectOption value="easter_relative">
							{m.holidays_type_easter()}
						</NativeSelectOption>
						<NativeSelectOption value="one_off">
							{m.holidays_type_one_off()}
						</NativeSelectOption>
					</NativeSelect>
				</Field>

				{type === "fixed" && (
					<div className="grid grid-cols-2 gap-4">
						<Field data-invalid={!!errors.month}>
							<FieldLabel htmlFor="holiday-month">
								{m.holidays_month()}
							</FieldLabel>
							<NativeSelect
								id="holiday-month"
								className="w-full"
								{...register("month")}
							>
								<NativeSelectOption value="">
									{m.holidays_month_placeholder()}
								</NativeSelectOption>
								{monthNames().map((label, i) => (
									<NativeSelectOption key={label} value={String(i + 1)}>
										{label}
									</NativeSelectOption>
								))}
							</NativeSelect>
							<FieldError errors={[errors.month]} />
						</Field>
						<Field data-invalid={!!errors.day}>
							<FieldLabel htmlFor="holiday-day">{m.holidays_day()}</FieldLabel>
							<Input
								id="holiday-day"
								type="number"
								min={1}
								max={31}
								placeholder="1-31"
								{...register("day")}
							/>
							<FieldError errors={[errors.day]} />
						</Field>
					</div>
				)}

				{type === "easter_relative" && (
					<Field data-invalid={!!errors.easterOffsetDays}>
						<FieldLabel htmlFor="holiday-offset">
							{m.holidays_easter_holiday()}
						</FieldLabel>
						<NativeSelect
							id="holiday-offset"
							className="w-full"
							{...register("easterOffsetDays")}
						>
							<NativeSelectOption value="0">
								{m.holidays_easter_sunday()}
							</NativeSelectOption>
							<NativeSelectOption value="1">
								{m.holidays_easter_monday_option()}
							</NativeSelectOption>
						</NativeSelect>
						<FieldError errors={[errors.easterOffsetDays]} />
					</Field>
				)}

				{type === "one_off" && (
					<Field data-invalid={!!errors.oneOffDate}>
						<FieldLabel htmlFor="holiday-date">{m.holidays_date()}</FieldLabel>
						<Input id="holiday-date" type="date" {...register("oneOffDate")} />
						<FieldError errors={[errors.oneOffDate]} />
					</Field>
				)}
			</div>

			<div className="flex justify-end gap-3">
				<Button type="button" variant="outline" onClick={onCancel}>
					{m.common_cancel()}
				</Button>
				<Button type="submit" disabled={isPending}>
					{isPending ? m.common_creating() : m.common_create()}
				</Button>
			</div>
		</form>
	);
}
