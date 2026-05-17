import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DiscountPercentInput } from "@/features/promotions/components/discount-percent-input";
import { DiscountPeriodPicker } from "@/features/promotions/components/discount-period-picker";
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
	onCancel?: () => void;
	onPercentChange?: (percent: number) => void;
	onTitleChange?: (title: string) => void;
	submitting?: boolean;
}

function defaultLocalNow(): string {
	const d = new Date();
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
		d.getHours(),
	)}:${pad(d.getMinutes())}`;
}

export function DiscountForm({
	defaultValues,
	disablePercent,
	disableStartsAt,
	submitLabel,
	onSubmit,
	onCancel,
	onPercentChange,
	onTitleChange,
	submitting,
}: DiscountFormProps) {
	const form = useForm<DiscountFormInput, unknown, DiscountFormValues>({
		resolver: zodResolver(discountFormSchema),
		defaultValues: {
			title: "",
			percent: 10,
			startsAt: defaultLocalNow(),
			endsAt: "",
			noEndDate: false,
			...defaultValues,
		},
	});

	const title = form.watch("title") ?? "";
	const percentRaw = form.watch("percent");
	const percent = Number(percentRaw);
	const safePercent = Number.isFinite(percent) ? percent : 0;
	const startsAt = form.watch("startsAt") ?? "";
	const endsAt = form.watch("endsAt") ?? "";
	const noEndDate = form.watch("noEndDate") ?? false;

	useEffect(() => {
		if (noEndDate) form.setValue("endsAt", "");
	}, [noEndDate, form]);

	useEffect(() => {
		if (!onPercentChange) return;
		if (Number.isFinite(safePercent) && safePercent > 0)
			onPercentChange(safePercent);
	}, [safePercent, onPercentChange]);

	useEffect(() => {
		if (!onTitleChange) return;
		onTitleChange(title);
	}, [title, onTitleChange]);

	return (
		<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
			<div className="space-y-2">
				<Label htmlFor="title">{m.promotions_form_title_label()}</Label>
				<Input
					id="title"
					maxLength={80}
					placeholder={m.promotions_form_title_placeholder()}
					{...form.register("title")}
				/>
				<p className="text-muted-foreground text-xs">
					{m.promotions_form_title_helper()}
				</p>
				{form.formState.errors.title && (
					<p className="text-destructive text-sm">
						{form.formState.errors.title.message}
					</p>
				)}
			</div>

			<DiscountPercentInput
				value={safePercent}
				onChange={(n) => form.setValue("percent", n, { shouldValidate: true })}
				disabled={disablePercent}
				error={form.formState.errors.percent?.message}
			/>

			<DiscountPeriodPicker
				startsAt={startsAt}
				endsAt={endsAt}
				noEndDate={noEndDate}
				disableStartsAt={disableStartsAt}
				onChange={(next) => {
					form.setValue("startsAt", next.startsAt, { shouldDirty: true });
					form.setValue("endsAt", next.endsAt, { shouldDirty: true });
					form.setValue("noEndDate", next.noEndDate, {
						shouldDirty: true,
						shouldValidate: true,
					});
				}}
				error={
					form.formState.errors.endsAt?.message ??
					form.formState.errors.startsAt?.message
				}
			/>

			{(disablePercent || disableStartsAt) && (
				<p className="text-muted-foreground text-xs">
					{m.promotions_form_started_disabled_hint()}
				</p>
			)}

			<div className="flex justify-end gap-3 pt-2">
				{onCancel && (
					<Button type="button" variant="outline" onClick={onCancel}>
						Annulla
					</Button>
				)}
				<Button type="submit" disabled={submitting || !form.formState.isDirty}>
					{submitLabel}
				</Button>
			</div>
		</form>
	);
}
