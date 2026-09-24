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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/billing/pricing")({
	component: PricingPage,
});

function PricingPage() {
	const qc = useQueryClient();
	const { data: current, isLoading } = useQuery({
		queryKey: ["admin", "billing", "pricing", "current"],
		queryFn: async () => {
			const r = await api().admin.billing.pricing.current.get();
			if (r.error) throw new Error(r.error.value?.message);
			return r.data?.data;
		},
	});

	const [open, setOpen] = useState(false);
	const [fields, setFields] = useState<PricingFields>(EMPTY_FIELDS);
	const [touched, setTouched] = useState<Set<keyof PricingFields>>(new Set());
	const parsed = parsePricingForm(fields);
	const errors = "errors" in parsed ? parsed.errors : {};

	const setField = (name: keyof PricingFields, value: string) => {
		setFields((prev) => ({ ...prev, [name]: value }));
		setTouched((prev) => new Set(prev).add(name));
	};
	const shownError = (name: keyof PricingFields) =>
		touched.has(name) && errors[name] ? [{ message: errors[name] }] : undefined;

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
			toast.success("Pricing aggiornato");
			setOpen(false);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (isLoading || !current) return <Spinner />;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Pricing corrente</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<p>
					<strong>Quota mensile:</strong> €
					{(current.storeMonthlyFeeCents / 100).toFixed(2)} {current.currency}
				</p>
				<p>
					<strong>Auto-cancel sospensione:</strong>{" "}
					{current.suspendedAutoCancelDays} giorni
				</p>
				<p>
					<strong>Expiry checkout pendente:</strong>{" "}
					{current.pendingCreationExpiryHours} ore
				</p>
				<p className="text-muted-foreground text-xs">
					Stripe Price ID: {current.stripePriceId}
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
									productId: "",
								});
								setTouched(new Set());
							}}
						>
							Modifica
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Modifica pricing</DialogTitle>
							<DialogDescription>
								Crea un nuovo Stripe Price. Le subscription esistenti restano
								sul prezzo precedente.
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-3">
							<Field data-invalid={!!shownError("fee")}>
								<FieldLabel htmlFor="pricing-fee">Quota mensile (€)</FieldLabel>
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
									Auto-cancel dopo (giorni)
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
									Expiry pending checkout (ore)
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
									Stripe Product ID
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
								Conferma
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</CardContent>
		</Card>
	);
}

interface PricingFields {
	fee: string;
	days: string;
	hours: string;
	productId: string;
}

interface PricingValue {
	storeMonthlyFeeCents: number;
	suspendedAutoCancelDays: number;
	pendingCreationExpiryHours: number;
	productId: string;
}

const EMPTY_FIELDS: PricingFields = {
	fee: "",
	days: "",
	hours: "",
	productId: "",
};

/** Whole number within [min, max], or null. Rejects "", "2.5", "1e3". */
function parseWhole(raw: string, min: number, max: number): number | null {
	if (!/^\d+$/.test(raw.trim())) return null;
	const n = Number(raw);
	return n >= min && n <= max ? n : null;
}

/**
 * The dialog keeps what the admin typed (strings) and turns it into numbers
 * only here, with the same bounds the API enforces — so an emptied field is
 * an error message, never a NaN in the request.
 */
function parsePricingForm(
	f: PricingFields,
):
	| { value: PricingValue }
	| { errors: Partial<Record<keyof PricingFields, string>> } {
	const errors: Partial<Record<keyof PricingFields, string>> = {};

	const fee = Number(f.fee.trim().replace(",", "."));
	const feeCents = Math.round(fee * 100);
	if (f.fee.trim() === "" || !Number.isFinite(fee) || feeCents < 100)
		errors.fee = "Inserisci una quota di almeno 1,00 €";

	const days = parseWhole(f.days, 7, 365);
	if (days === null) errors.days = "Un numero intero di giorni tra 7 e 365";

	const hours = parseWhole(f.hours, 1, 168);
	if (hours === null) errors.hours = "Un numero intero di ore tra 1 e 168";

	const productId = f.productId.trim();
	if (!/^prod_[A-Za-z0-9]+$/.test(productId))
		errors.productId = "L'ID prodotto Stripe inizia con prod_";

	if (Object.keys(errors).length > 0 || days === null || hours === null)
		return { errors };
	return {
		value: {
			storeMonthlyFeeCents: feeCents,
			suspendedAutoCancelDays: days,
			pendingCreationExpiryHours: hours,
			productId,
		},
	};
}
