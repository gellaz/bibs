import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@bibs/ui/components/alert-dialog";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, unwrap } from "@/lib/api";

interface Props {
	storeId: string;
	storeName: string;
	status: "active" | "past_due" | "canceling" | "suspended";
	currentPeriodEnd: Date | string;
	trigger: ReactNode;
}

export function CancelStoreDialog({
	storeId,
	storeName,
	status,
	currentPeriodEnd,
	trigger,
}: Props) {
	const qc = useQueryClient();

	const cancelMutation = useMutation({
		mutationFn: async () => {
			const r = await api().seller.stores({ storeId }).delete();
			return unwrap(r, "Errore").data;
		},
		onSuccess: (data) => {
			void qc.invalidateQueries({ queryKey: ["seller", "billing"] });
			void qc.invalidateQueries({ queryKey: ["stores"] });
			if ((data as any)?.status === "canceled") {
				toast.success(`${storeName} archiviato`);
			} else {
				toast.success(`Cancellazione programmata per ${storeName}`);
			}
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const isSuspended = status === "suspended";
	const periodEndDate = new Intl.DateTimeFormat("it-IT", {
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(new Date(currentPeriodEnd));

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					{/* Sospeso → archiviazione immediata e definitiva (destructive);
					    attivo → cancellazione programmata a fine periodo (warning). */}
					<AlertDialogMedia variant={isSuspended ? "destructive" : "warning"} />
					<AlertDialogTitle>
						{isSuspended
							? `Cancellare definitivamente "${storeName}"?`
							: `Cancellare il negozio "${storeName}"?`}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{isSuspended ? (
							<>
								Il negozio è già sospeso per mancato pagamento. Cancellandolo,
								sarà <strong>archiviato immediatamente</strong>. I dati storici
								(ordini, prodotti, recensioni) saranno conservati ma in sola
								lettura.
							</>
						) : (
							<>
								Continuerai a pagare e usarlo normalmente fino al{" "}
								<strong>{periodEndDate}</strong> (fine del ciclo già pagato).
								Dopo quella data il negozio sarà archiviato: non sarà più
								visibile ai clienti e tu non potrai più modificarlo. I dati
								storici saranno conservati ma in sola lettura.
							</>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Annulla</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => cancelMutation.mutate()}
						disabled={cancelMutation.isPending}
					>
						{isSuspended
							? "Cancella definitivamente"
							: "Conferma cancellazione"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
