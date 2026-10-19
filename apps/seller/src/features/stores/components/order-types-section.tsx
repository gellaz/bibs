import { Label } from "@bibs/ui/components/label";
import { Switch } from "@bibs/ui/components/switch";
import type { ReactNode } from "react";
import { FormSection } from "@/components/form-section";
import { m } from "@/paraglide/messages";
import { isToggleLocked, type OrderType } from "../lib/order-types";

/**
 * «Tipologie d'acquisto» del negozio, controllate: le salva la scheda Vendita.
 * Con «Prenota» accesa, sotto c'è il tempo per ritirare; sotto «Paga e
 * ritira», il riquadro dei pagamenti online da cui dipende.
 */
export function OrderTypesSection({
	value,
	onChange,
	chargesEnabled,
	disabled,
	reservationField,
	paymentsBox,
}: {
	value: OrderType[];
	onChange: (next: OrderType[]) => void;
	chargesEnabled: boolean;
	disabled: boolean;
	reservationField: ReactNode;
	paymentsBox: ReactNode;
}) {
	const on = (type: OrderType) => value.includes(type);
	const toggle = (type: OrderType, checked: boolean) =>
		onChange(checked ? [...value, type] : value.filter((t) => t !== type));
	const locked = (type: OrderType) =>
		disabled || isToggleLocked(type, value, chargesEnabled);

	return (
		<FormSection
			title={m.store_order_types_title()}
			description={m.store_order_types_description()}
		>
			<div className="divide-y divide-border rounded-lg border border-border">
				<div className="space-y-4 p-4">
					<Row
						id="order-type-reserve"
						label={m.orders_type_reserve_pickup()}
						hint={m.store_order_types_reserve_hint()}
						checked={on("reserve_pickup")}
						disabled={locked("reserve_pickup")}
						onChange={(checked) => toggle("reserve_pickup", checked)}
					/>
					{on("reserve_pickup") && (
						<div className="space-y-3 rounded-md border border-border p-3">
							{reservationField}
						</div>
					)}
				</div>
				<div className="space-y-3 p-4">
					<Row
						id="order-type-pay"
						label={m.orders_type_pay_pickup()}
						hint={m.store_order_types_pay_hint()}
						checked={on("pay_pickup")}
						disabled={locked("pay_pickup")}
						onChange={(checked) => toggle("pay_pickup", checked)}
					/>
					{paymentsBox}
				</div>
			</div>
		</FormSection>
	);
}

function Row(props: {
	id: string;
	label: string;
	hint: string;
	checked: boolean;
	disabled: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-start justify-between gap-4">
			<div className="space-y-1">
				<Label htmlFor={props.id} className="font-semibold">
					{props.label}
				</Label>
				<p className="text-sm text-muted-foreground">{props.hint}</p>
			</div>
			<Switch
				id={props.id}
				checked={props.checked}
				disabled={props.disabled}
				onCheckedChange={props.onChange}
			/>
		</div>
	);
}
