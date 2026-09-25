import { RadioGroup, RadioGroupItem } from "@bibs/ui/components/radio-group";
import { m } from "@/paraglide/messages";
import type { CheckoutType } from "./checkout-choice";

const LABEL: Record<CheckoutType, () => string> = {
	reserve_pickup: m.checkout_type_reserve_pickup,
	pay_pickup: m.checkout_type_pay_pickup,
};

const RESERVATION_HOURS = 48;

const HINT: Record<CheckoutType, () => string> = {
	reserve_pickup: () =>
		m.checkout_type_reserve_pickup_hint({ hours: RESERVATION_HOURS }),
	pay_pickup: m.checkout_type_pay_pickup_hint,
};

export function checkoutTypeLabel(type: CheckoutType) {
	return LABEL[type]();
}

/** Scelta della modalità per un negozio: una riga intera cliccabile per
 *  opzione (≥44px), con la spiegazione sotto l'etichetta. */
export function StoreChoice({
	storeId,
	options,
	value,
	onChange,
}: {
	storeId: string;
	options: CheckoutType[];
	value: CheckoutType | undefined;
	onChange: (v: CheckoutType) => void;
}) {
	return (
		<RadioGroup
			value={value}
			onValueChange={(v) => onChange(v as CheckoutType)}
			className="gap-2"
		>
			{options.map((type) => {
				const id = `${storeId}-${type}`;
				return (
					<label
						key={type}
						htmlFor={id}
						className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[[data-state=checked]]:border-foreground"
					>
						<RadioGroupItem id={id} value={type} className="mt-0.5" />
						<span className="space-y-0.5">
							<span className="block font-medium text-foreground text-sm">
								{LABEL[type]()}
							</span>
							<span className="block text-muted-foreground text-sm">
								{HINT[type]()}
							</span>
						</span>
					</label>
				);
			})}
		</RadioGroup>
	);
}
