import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { Switch } from "@bibs/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { FormSection } from "@/components/form-section";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

type OrderType = "reserve_pickup" | "pay_pickup";

/**
 * «Tipologie d'acquisto» del negozio: switch immediati per reserve_pickup /
 * pay_pickup. pay_pickup richiede chargesEnabled per essere acceso (Task 5);
 * offeredOrderTypes riflette cosa vede davvero il cliente (fino alla PR F
 * resta senza pay_pickup anche ad account abilitato: ONLINE_PAYMENT_LIVE).
 */
export function OrderTypesSection({ storeId }: { storeId: string }) {
	const qc = useQueryClient();
	const key = ["store", storeId, "order-types"];
	const { data } = useQuery({
		queryKey: key,
		queryFn: async () =>
			unwrap(
				await api().seller.stores({ storeId })["order-types"].get(),
				m["store.orderTypes.error"](),
			).data,
	});

	const save = useMutation({
		mutationFn: async (orderTypes: OrderType[]) =>
			unwrap(
				await api().seller.stores({ storeId })["order-types"].patch({
					orderTypes,
				}),
				m["store.orderTypes.error"](),
			).data,
		onSuccess: (next) => {
			qc.setQueryData(key, next);
			toast.success(m["store.orderTypes.saved"]());
		},
		onError: (error: Error) => toast.error(error.message),
	});

	if (!data) {
		return (
			<FormSection title={m["store.orderTypes.title"]()}>{null}</FormSection>
		);
	}

	const on = (type: OrderType) => data.orderTypes.includes(type);
	const toggle = (type: OrderType, checked: boolean) =>
		save.mutate(
			checked
				? [...data.orderTypes, type]
				: data.orderTypes.filter((t) => t !== type),
		);

	const payOn = on("pay_pickup");
	const payOffered = data.offeredOrderTypes.includes("pay_pickup");
	// Spegnere l'ultima tipologia offerta lo rifiuterebbe l'API (regola 2b
	// del design): si disabilita prima lato FE.
	const lastOffered = (type: OrderType) =>
		data.offeredOrderTypes.length === 1 && data.offeredOrderTypes[0] === type;

	return (
		<FormSection
			title={m["store.orderTypes.title"]()}
			description={m["store.orderTypes.description"]()}
		>
			<div className="space-y-5">
				<Row
					id="order-type-reserve"
					label={m.orders_type_reserve_pickup()}
					hint={m["store.orderTypes.reserve.hint"]()}
					checked={on("reserve_pickup")}
					disabled={
						save.isPending ||
						(on("reserve_pickup") && lastOffered("reserve_pickup"))
					}
					onChange={(checked) => toggle("reserve_pickup", checked)}
				/>
				<Row
					id="order-type-pay"
					label={m.orders_type_pay_pickup()}
					hint={m["store.orderTypes.pay.hint"]()}
					checked={payOn}
					// Accendere richiede il conto abilitato; spegnere è sempre permesso.
					disabled={
						save.isPending ||
						(!payOn && !data.chargesEnabled) ||
						(payOn && lastOffered("pay_pickup"))
					}
					onChange={(checked) => toggle("pay_pickup", checked)}
				>
					{!payOn && !data.chargesEnabled && (
						<p className="text-xs text-muted-foreground">
							{m["store.orderTypes.pay.needsPayments"]()}{" "}
							<Link
								to="/profile"
								className="font-medium text-foreground underline-offset-4 hover:underline"
							>
								{m["store.orderTypes.pay.goToProfile"]()}
							</Link>
						</p>
					)}
					{payOn && !payOffered && (
						<p className="text-xs text-muted-foreground">
							{data.chargesEnabled
								? m["store.orderTypes.pay.notOffered"]()
								: m["store.orderTypes.pay.accountDisabled"]()}
						</p>
					)}
				</Row>
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
	children?: ReactNode;
}) {
	return (
		<div className="flex items-start justify-between gap-4">
			<div className="space-y-1">
				<Label htmlFor={props.id}>{props.label}</Label>
				<p className="text-xs text-muted-foreground">{props.hint}</p>
				{props.children}
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
