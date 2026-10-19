import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { useDebouncedValue } from "@bibs/ui/hooks/use-debounced-value";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";
import {
	parseReservationHours,
	RESERVATION_HOURS_MAX,
	RESERVATION_HOURS_MIN,
} from "../lib/reservation-hours";

const DATE_FMT: Intl.DateTimeFormatOptions = {
	weekday: "short",
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
	// Gli orari del negozio sono a Roma: lo è anche la scadenza d'esempio.
	timeZone: "Europe/Rome",
};

/**
 * «Tempo per ritirare» di «Prenota e paga in negozio»: ore di apertura entro
 * cui il cliente ritira. L'esempio di scadenza lo calcola l'API col valore non
 * ancora salvato, con la stessa funzione della conferma dell'ordine; la chiave
 * sotto ["store", storeId] lo rinfresca quando si salvano gli orari.
 */
export function ReservationHoursField({
	storeId,
	value,
	hasOpeningHours,
}: {
	storeId: string;
	value: number;
	hasOpeningHours: boolean;
}) {
	const qc = useQueryClient();
	const [draft, setDraft] = useState(String(value));
	const parsed = parseReservationHours(draft);
	const invalid = parsed === null;
	const hours = useDebouncedValue(parsed, 300);

	const preview = useQuery({
		queryKey: ["store", storeId, "reservation-preview", hours],
		enabled: hours !== null && hasOpeningHours,
		// Tiene l'esempio precedente mentre arriva il nuovo: il riquadro non sparisce.
		placeholderData: keepPreviousData,
		queryFn: async () =>
			unwrap(
				await api()
					.seller.stores({ storeId })
					["reservation-preview"].get({ query: { hours: hours as number } }),
				m.store_reservation_hours_error(),
			).data,
	});

	const save = useMutation({
		mutationFn: async (reservationHours: number) =>
			unwrap(
				await api().seller.stores({ storeId }).patch({ reservationHours }),
				m.store_reservation_hours_error(),
			).data,
		onSuccess: (store) => {
			setDraft(String(store.reservationHours));
			void qc.invalidateQueries({ queryKey: ["stores"] });
			void qc.invalidateQueries({ queryKey: ["store", storeId] });
			toast.success(m.store_reservation_hours_saved());
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<>
			<form
				className="space-y-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					if (parsed !== null) save.mutate(parsed);
				}}
			>
				<Label htmlFor="reservation-hours">
					{m.store_reservation_hours_label()}
				</Label>
				<div className="flex flex-wrap items-center gap-2">
					<Input
						id="reservation-hours"
						type="number"
						inputMode="numeric"
						min={RESERVATION_HOURS_MIN}
						max={RESERVATION_HOURS_MAX}
						step={1}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						aria-invalid={invalid}
						aria-describedby={invalid ? "reservation-hours-error" : undefined}
						className="w-20"
					/>
					<span className="text-sm text-muted-foreground">
						{hasOpeningHours
							? parsed === 1
								? m.store_reservation_hours_unit_one()
								: m.store_reservation_hours_unit()
							: parsed === 1
								? m.store_reservation_hours_unit_calendar_one()
								: m.store_reservation_hours_unit_calendar()}
					</span>
					<Button
						type="submit"
						variant="outline"
						disabled={invalid || parsed === value || save.isPending}
					>
						{m.store_reservation_hours_save()}
					</Button>
				</div>
				{invalid && (
					<p id="reservation-hours-error" className="text-xs text-destructive">
						{m.store_reservation_hours_invalid()}
					</p>
				)}
			</form>
			<p className="text-xs leading-relaxed text-muted-foreground">
				{hasOpeningHours
					? m.store_reservation_hours_help()
					: m.store_reservation_hours_help_calendar()}
			</p>
			{hasOpeningHours ? (
				preview.data && (
					<p className="rounded-md bg-muted p-2.5 text-xs leading-relaxed text-foreground">
						{m.store_reservation_hours_example()}{" "}
						<strong className="font-semibold">
							{new Date(preview.data.expiresAt).toLocaleString(
								intlLocale(),
								DATE_FMT,
							)}
						</strong>
						.
					</p>
				)
			) : (
				<p className="rounded-md bg-muted p-2.5 text-xs leading-relaxed text-foreground">
					{m.store_reservation_hours_no_hours()}{" "}
					<a
						href="#store-opening-hours"
						className="font-medium underline underline-offset-4"
					>
						{m.store_reservation_hours_add_hours()}
					</a>
				</p>
			)}
			<p className="text-xs text-muted-foreground">
				{m.store_reservation_hours_existing()}
			</p>
		</>
	);
}
