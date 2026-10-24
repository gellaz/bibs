import { RadioGroup, RadioGroupItem } from "@bibs/ui/components/radio-group";
import { formatPickupDate } from "@/features/orders/order-display";
import { m } from "@/paraglide/messages";
import type { CheckoutType } from "./checkout-choice";
import { formatPoints } from "./points-toggle";
import type { ReservationInfo } from "./reservation-copy";

const LABEL: Record<CheckoutType, () => string> = {
	reserve_pickup: m.checkout_type_reserve_pickup,
	pay_pickup: m.checkout_type_pay_pickup,
};

/** «24 ore di apertura» / «1 ora»: mai «di apertura» per un negozio senza orari. */
export function reserveDuration(r: ReservationInfo) {
	if (r.clock === "opening")
		return r.hours === 1
			? m.reserve_duration_opening_one()
			: m.reserve_duration_opening({ hours: r.hours });
	return r.hours === 1
		? m.reserve_duration_calendar_one()
		: m.reserve_duration_calendar({ hours: r.hours });
}

/** Spiegazione di «Prenota e paga in negozio» con la scadenza se confermi adesso. */
function ReserveHint({ reservation }: { reservation?: ReservationInfo }) {
	if (!reservation) return m.checkout_type_reserve_pickup_hint_short();
	return (
		<>
			{m.checkout_type_reserve_pickup_hint_deadline({
				duration: reserveDuration(reservation),
			})}{" "}
			<strong className="font-medium text-foreground">
				{formatPickupDate(reservation.expiresAt)}
			</strong>
			.
		</>
	);
}

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
	pointsBalance,
	reservation,
}: {
	storeId: string;
	options: CheckoutType[];
	value: CheckoutType | undefined;
	onChange: (v: CheckoutType) => void;
	/** Saldo punti del cliente: se c'è, la spiegazione di `pay_pickup` lo ricorda. */
	pointsBalance?: number;
	/** Scadenza se confermi adesso; assente finché non arriva dall'API. */
	reservation?: ReservationInfo;
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
						className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[[data-checked]]:border-foreground"
					>
						<RadioGroupItem id={id} value={type} className="mt-0.5" />
						<span className="space-y-0.5">
							<span className="block font-medium text-foreground text-sm">
								{LABEL[type]()}
							</span>
							<span className="block text-muted-foreground text-sm">
								{type === "reserve_pickup" ? (
									<ReserveHint reservation={reservation} />
								) : (
									m.checkout_type_pay_pickup_hint()
								)}
								{type === "pay_pickup" && pointsBalance
									? ` ${m.checkout_type_pay_pickup_points_hint({ points: formatPoints(pointsBalance) })}`
									: null}
							</span>
						</span>
					</label>
				);
			})}
		</RadioGroup>
	);
}
