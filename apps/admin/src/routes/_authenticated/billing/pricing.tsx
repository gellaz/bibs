import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@bibs/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { formatPriceEur } from "@bibs/ui/custom/price";
import { unwrap } from "@bibs/ui/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	EMPTY_PRICING_FIELDS,
	expiryHoursLabel,
	type PricingFields,
	type PricingValue,
	parsePricingForm,
} from "@/features/billing/pricing-form";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/billing/pricing")({
	component: PricingPage,
});

function PricingPage() {
	const qc = useQueryClient();
	const {
		data: current,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["admin", "billing", "pricing", "current"],
		queryFn: async () => {
			const r = await api().admin.billing.pricing.current.get();
			return unwrap(r, m.billing_pricing_load_error()).data;
		},
	});

	const [open, setOpen] = useState(false);
	const [fields, setFields] = useState<PricingFields>(EMPTY_PRICING_FIELDS);
	const [touched, setTouched] = useState<Set<keyof PricingFields>>(new Set());
	const parsed = parsePricingForm(fields);
	const errors = "errors" in parsed ? parsed.errors : {};

	const setField = (name: keyof PricingFields, value: string) => {
		setFields((prev) => ({ ...prev, [name]: value }));
		setTouched((prev) => new Set(prev).add(name));
	};
	// productId is prefilled from the active config, but rows created before
	// it was stored have none: then its error shows from the start, otherwise
	// Conferma is disabled with no reason given.
	const shownError = (name: keyof PricingFields) =>
		(touched.has(name) || name === "productId") && errors[name]
			? [{ message: errors[name] }]
			: undefined;

	const mutation = useMutation({
		mutationFn: async (value: PricingValue) => {
			const r = await api().admin.billing.pricing.put({
				...value,
				currency: "EUR",
			});
			if (r.error) throw new Error(r.error.value?.message);
			return r.data?.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
			toast.success(m.billing_pricing_updated());
			setOpen(false);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (error)
		return (
			<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
				<p className="text-sm">
					{m.common_load_error_with_message({ message: error.message })}
				</p>
			</div>
		);
	if (isLoading || !current) return <Spinner />;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{m.billing_pricing_current()}</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<p>
					<strong>{m.billing_pricing_monthly_fee()}</strong>{" "}
					{formatPriceEur(current.storeMonthlyFeeCents / 100)}
				</p>
				<p>
					<strong>{m.billing_pricing_auto_cancel()}</strong>{" "}
					{m.billing_pricing_days({ count: current.suspendedAutoCancelDays })}
				</p>
				<p>
					<strong>{m.billing_pricing_expiry()}</strong>{" "}
					{expiryHoursLabel(current.pendingCreationExpiryHours)}
				</p>
				<p className="text-muted-foreground text-xs">
					{m.billing_pricing_price_id({ id: current.stripePriceId })}
				</p>

				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button
							className="mt-4 self-start"
							onClick={() => {
								setFields({
									fee: (current.storeMonthlyFeeCents / 100).toFixed(2),
									days: String(current.suspendedAutoCancelDays),
									hours: String(current.pendingCreationExpiryHours),
									productId: current.stripeProductId ?? "",
								});
								setTouched(new Set());
							}}
						>
							{m.common_edit()}
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{m.billing_pricing_dialog_title()}</DialogTitle>
							<DialogDescription>
								{m.billing_pricing_dialog_description()}
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-3">
							<Field data-invalid={!!shownError("fee")}>
								<FieldLabel htmlFor="pricing-fee">
									{m.billing_pricing_fee_label()}
								</FieldLabel>
								<Input
									id="pricing-fee"
									type="number"
									step="0.01"
									min="1"
									value={fields.fee}
									onChange={(e) => setField("fee", e.target.value)}
								/>
								<FieldError errors={shownError("fee")} />
							</Field>
							<Field data-invalid={!!shownError("days")}>
								<FieldLabel htmlFor="pricing-days">
									{m.billing_pricing_days_label()}
								</FieldLabel>
								<Input
									id="pricing-days"
									type="number"
									min="7"
									max="365"
									value={fields.days}
									onChange={(e) => setField("days", e.target.value)}
								/>
								<FieldError errors={shownError("days")} />
							</Field>
							<Field data-invalid={!!shownError("hours")}>
								<FieldLabel htmlFor="pricing-hours">
									{m.billing_pricing_hours_label()}
								</FieldLabel>
								<Input
									id="pricing-hours"
									type="number"
									min="1"
									max="168"
									value={fields.hours}
									onChange={(e) => setField("hours", e.target.value)}
								/>
								<FieldError errors={shownError("hours")} />
							</Field>
							<Field data-invalid={!!shownError("productId")}>
								<FieldLabel htmlFor="pricing-product">
									{m.billing_pricing_product_label()}
								</FieldLabel>
								<Input
									id="pricing-product"
									value={fields.productId}
									onChange={(e) => setField("productId", e.target.value)}
									placeholder="prod_..."
								/>
								<FieldError errors={shownError("productId")} />
							</Field>
						</div>
						<DialogFooter>
							<Button
								onClick={() => {
									if ("value" in parsed) mutation.mutate(parsed.value);
								}}
								disabled={!("value" in parsed) || mutation.isPending}
							>
								{m.common_confirm()}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</CardContent>
		</Card>
	);
}
