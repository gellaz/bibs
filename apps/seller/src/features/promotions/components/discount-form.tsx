import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { Switch } from "@bibs/ui/components/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { m } from "@/paraglide/messages";

export const discountFormSchema = z
	.object({
		title: z.string().min(1).max(80),
		percent: z.coerce.number().int().min(1).max(99),
		startsAt: z.string().min(1),
		endsAt: z.string().optional(),
		noEndDate: z.boolean(),
	})
	.refine(
		(v) =>
			v.noEndDate ||
			(v.endsAt != null &&
				v.endsAt.length > 0 &&
				new Date(v.endsAt) > new Date(v.startsAt)),
		{
			message: "La data di fine deve essere successiva all'inizio",
			path: ["endsAt"],
		},
	);

export type DiscountFormInput = z.input<typeof discountFormSchema>;
export type DiscountFormValues = z.output<typeof discountFormSchema>;

export interface DiscountFormProps {
	defaultValues?: Partial<DiscountFormInput>;
	disablePercent?: boolean;
	disableStartsAt?: boolean;
	submitLabel: string;
	onSubmit: (values: DiscountFormValues) => Promise<void> | void;
	submitting?: boolean;
}

export function DiscountForm({
	defaultValues,
	disablePercent,
	disableStartsAt,
	submitLabel,
	onSubmit,
	submitting,
}: DiscountFormProps) {
	const form = useForm<DiscountFormInput, unknown, DiscountFormValues>({
		resolver: zodResolver(discountFormSchema),
		defaultValues: {
			title: "",
			percent: 10,
			startsAt: new Date().toISOString().slice(0, 16),
			endsAt: "",
			noEndDate: false,
			...defaultValues,
		},
	});

	const noEndDate = form.watch("noEndDate");
	useEffect(() => {
		if (noEndDate) form.setValue("endsAt", "");
	}, [noEndDate, form]);

	return (
		<form
			onSubmit={form.handleSubmit(onSubmit)}
			className="max-w-2xl space-y-4"
		>
			<div className="space-y-2">
				<Label htmlFor="title">{m.promotions_form_title_label()}</Label>
				<Input
					id="title"
					placeholder={m.promotions_form_title_placeholder()}
					{...form.register("title")}
				/>
				{form.formState.errors.title && (
					<p className="text-destructive text-sm">
						{form.formState.errors.title.message}
					</p>
				)}
			</div>

			<div className="space-y-2">
				<Label htmlFor="percent">{m.promotions_form_percent_label()}</Label>
				<div className="relative max-w-[8rem]">
					<Input
						id="percent"
						type="number"
						min={1}
						max={99}
						step={1}
						disabled={disablePercent}
						{...form.register("percent")}
					/>
					<span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-sm">
						%
					</span>
				</div>
				{form.formState.errors.percent && (
					<p className="text-destructive text-sm">
						{form.formState.errors.percent.message}
					</p>
				)}
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="startsAt">
						{m.promotions_form_starts_at_label()}
					</Label>
					<Input
						id="startsAt"
						type="datetime-local"
						disabled={disableStartsAt}
						{...form.register("startsAt")}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="endsAt">{m.promotions_form_ends_at_label()}</Label>
					<Input
						id="endsAt"
						type="datetime-local"
						disabled={noEndDate}
						{...form.register("endsAt")}
					/>
					{form.formState.errors.endsAt && (
						<p className="text-destructive text-sm">
							{form.formState.errors.endsAt.message}
						</p>
					)}
				</div>
			</div>

			<div className="flex items-center gap-2">
				<Switch
					id="noEndDate"
					checked={noEndDate}
					onCheckedChange={(v) => form.setValue("noEndDate", v)}
				/>
				<Label htmlFor="noEndDate">{m.promotions_form_no_end_date()}</Label>
			</div>

			{(disablePercent || disableStartsAt) && (
				<p className="text-muted-foreground text-xs">
					{m.promotions_form_started_disabled_hint()}
				</p>
			)}

			<Button type="submit" disabled={submitting}>
				{submitLabel}
			</Button>
		</form>
	);
}
