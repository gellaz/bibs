import { closedNoteOpensAt } from "@/features/checkout/reservation-copy";
import { describeOpensAt } from "@/features/stores/open-status";
import { m } from "@/paraglide/messages";

/**
 * Sotto il timer di una prenotazione aperta: se adesso il negozio è chiuso,
 * dice quando riapre, così il conto alla rovescia che scorre di notte non
 * spaventa. Niente se il negozio è aperto, senza orari o riapre a scadenza passata.
 */
export function StoreClosedNote(props: {
	expiresAt: Date | string;
	openStatus?: Parameters<typeof closedNoteOpensAt>[0]["openStatus"];
}) {
	const opensAt = closedNoteOpensAt({ open: true, ...props });
	if (!opensAt) return null;
	return (
		<p className="text-muted-foreground text-sm">
			{m.orders_store_closed_note({ opens: describeOpensAt(opensAt) })}
		</p>
	);
}
