import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { z } from "zod";
import { m } from "@/paraglide/messages";

export const holidayFormSchema = z
	.object({
		type: z.enum(["fixed", "easter_relative", "one_off"]),
		name: z.string().min(1, { error: () => m.common_name_required() }),
		month: z.string().optional(),
		day: z.string().optional(),
		easterOffsetDays: z.string().optional(),
		oneOffDate: z.string().optional(),
	})
	.superRefine((v, ctx) => {
		if (v.type === "fixed") {
			const month = Number(v.month);
			const day = Number(v.day);
			if (!v.month || month < 1 || month > 12)
				ctx.addIssue({
					code: "custom",
					path: ["month"],
					message: m.holidays_month_invalid(),
				});
			if (!v.day || day < 1 || day > 31)
				ctx.addIssue({
					code: "custom",
					path: ["day"],
					message: m.holidays_day_invalid(),
				});
		} else if (v.type === "easter_relative") {
			if (v.easterOffsetDays === undefined || v.easterOffsetDays === "")
				ctx.addIssue({
					code: "custom",
					path: ["easterOffsetDays"],
					message: m.holidays_offset_required(),
				});
		} else if (v.type === "one_off") {
			if (!v.oneOffDate || !/^\d{4}-\d{2}-\d{2}$/.test(v.oneOffDate))
				ctx.addIssue({
					code: "custom",
					path: ["oneOffDate"],
					message: m.holidays_date_required(),
				});
		}
	});

export type HolidayFormData = z.infer<typeof holidayFormSchema>;

/** I dodici mesi nella lingua corrente, con l'iniziale maiuscola («Gennaio»). */
export function monthNames(): string[] {
	const fmt = new Intl.DateTimeFormat(intlLocale(), { month: "long" });
	return Array.from({ length: 12 }, (_, i) => {
		const name = fmt.format(new Date(2000, i, 1));
		return name.charAt(0).toUpperCase() + name.slice(1);
	});
}
