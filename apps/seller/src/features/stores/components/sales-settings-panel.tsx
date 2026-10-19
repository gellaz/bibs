import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormSection } from "@/components/form-section";
import { SaveBar } from "@/components/save-bar";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";
import type { OrderType } from "../lib/order-types";
import { parseReservationHours } from "../lib/reservation-hours";
import {
	LowStockThresholdSection,
	parseThreshold,
} from "./low-stock-threshold-section";
import { OrderTypesSection } from "./order-types-section";
import { ReservationHoursField } from "./reservation-hours-field";

const sameSet = (a: OrderType[], b: OrderType[]) =>
	a.length === b.length && a.every((t) => b.includes(t));

/**
 * Scheda «Vendita»: tipologie d'acquisto, tempo per ritirare e scorta bassa,
 * con un solo Salva (order-types e PATCH del negozio, solo ciò che è cambiato).
 */
export function SalesSettingsPanel({
	storeId,
	reservationHours,
	lowStockThreshold,
	hasOpeningHours,
}: {
	storeId: string;
	reservationHours: number;
	lowStockThreshold: number;
	hasOpeningHours: boolean;
}) {
	const qc = useQueryClient();
	const typesKey = ["store", storeId, "order-types"];
	const { data } = useQuery({
		queryKey: typesKey,
		queryFn: async () =>
			unwrap(
				await api().seller.stores({ storeId })["order-types"].get(),
				m.store_order_types_error(),
			).data,
	});

	const [typesDraft, setTypesDraft] = useState<OrderType[] | null>(null);
	const [saved, setSaved] = useState({ reservationHours, lowStockThreshold });
	const [reservationDraft, setReservationDraft] = useState(
		String(reservationHours),
	);
	const [lowStockDraft, setLowStockDraft] = useState(String(lowStockThreshold));

	const types = typesDraft ?? data?.orderTypes ?? [];
	const typesDirty =
		!!data && typesDraft !== null && !sameSet(typesDraft, data.orderTypes);
	// Con «Prenota» spenta il tempo per ritirare non si vede e non si salva.
	const reservationDirty =
		types.includes("reserve_pickup") &&
		reservationDraft.trim() !== String(saved.reservationHours);
	const lowStockDirty =
		lowStockDraft.trim() !== String(saved.lowStockThreshold);
	const parsedReservation = parseReservationHours(reservationDraft);
	const parsedLowStock = parseThreshold(lowStockDraft);
	const invalid =
		(reservationDirty && parsedReservation === null) ||
		(lowStockDirty && parsedLowStock === null);

	const save = useMutation({
		mutationFn: async () => {
			if (typesDirty && typesDraft) {
				const next = unwrap(
					await api()
						.seller.stores({ storeId })
						["order-types"].patch({ orderTypes: typesDraft }),
					m.store_order_types_error(),
				).data;
				qc.setQueryData(typesKey, next);
				setTypesDraft(null);
			}
			const patch: { reservationHours?: number; lowStockThreshold?: number } =
				{};
			if (reservationDirty && parsedReservation !== null)
				patch.reservationHours = parsedReservation;
			if (lowStockDirty && parsedLowStock !== null)
				patch.lowStockThreshold = parsedLowStock;
			if (Object.keys(patch).length > 0) {
				const store = unwrap(
					await api().seller.stores({ storeId }).patch(patch),
					m.store_update_error(),
				).data;
				setSaved({
					reservationHours: store.reservationHours,
					lowStockThreshold: store.lowStockThreshold,
				});
				setReservationDraft(String(store.reservationHours));
				setLowStockDraft(String(store.lowStockThreshold));
			}
		},
		onSuccess: () => toast.success(m.store_sales_saved()),
		onError: (error: Error) => toast.error(error.message),
		onSettled: () => {
			void qc.invalidateQueries({ queryKey: ["stores"] });
			void qc.invalidateQueries({ queryKey: ["store", storeId] });
			void qc.invalidateQueries({
				queryKey: ["seller", "dashboard", storeId],
			});
		},
	});

	return (
		<div className="@container flex flex-1 flex-col gap-12">
			{/* Come Orari e chiusure: affiancati sugli schermi larghi, e spenti
			    mentre salva perché la risposta riscrive i campi. */}
			<fieldset
				disabled={save.isPending}
				className="grid min-w-0 gap-x-10 gap-y-12 @5xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
			>
				{data ? (
					<OrderTypesSection
						value={types}
						onChange={setTypesDraft}
						chargesEnabled={data.chargesEnabled}
						disabled={save.isPending}
						reservationField={
							<ReservationHoursField
								storeId={storeId}
								value={reservationDraft}
								onChange={setReservationDraft}
								hasOpeningHours={hasOpeningHours}
							/>
						}
					/>
				) : (
					<FormSection title={m.store_order_types_title()}>{null}</FormSection>
				)}
				<LowStockThresholdSection
					value={lowStockDraft}
					onChange={setLowStockDraft}
				/>
			</fieldset>
			<SaveBar
				dirty={typesDirty || reservationDirty || lowStockDirty}
				pending={save.isPending}
				disabled={invalid}
				submitLabel={m.store_settings_save()}
				pendingLabel={m.store_settings_saving()}
				onSave={() => save.mutate()}
			/>
		</div>
	);
}
