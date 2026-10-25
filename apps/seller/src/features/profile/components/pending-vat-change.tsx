import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { StatusBadge } from "@bibs/ui/custom/status-badge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface Props {
	change: { id: string; changeData: unknown };
	canCancel: boolean;
}

/** Cambio di partita IVA in attesa: sostituisce «Richiedi cambio» finché un admin non decide. */
export function PendingVatChange({ change, canCancel }: Props) {
	const qc = useQueryClient();
	const vatNumber = (change.changeData as { vatNumber?: string }).vatNumber;

	const cancel = useMutation({
		mutationFn: async () => {
			const r = await api()
				.seller.settings.changes({ changeId: change.id })
				.cancel.patch();
			return unwrap(r, m.profile_vat_request_error());
		},
		onSuccess: () => toast.success(m.profile_vat_cancelled()),
		onError: (e: Error) => toast.error(e.message),
		// Anche con «non più in attesa» ricarica: l'admin ha già deciso.
		onSettled: () => qc.invalidateQueries({ queryKey: ["seller", "settings"] }),
	});

	return (
		<div className="space-y-2 rounded-md border border-warning-foreground/15 bg-warning p-3 text-sm text-warning-foreground">
			<div className="flex flex-wrap items-center gap-2">
				<span>{m.profile_vat_pending_label()}</span>
				<span className="font-medium">{vatNumber}</span>
				<StatusBadge tone="waiting" icon={Clock} className="bg-background">
					{m.profile_vat_pending_badge()}
				</StatusBadge>
			</div>
			<p>{m.profile_vat_pending_notice()}</p>
			{canCancel && (
				<AlertDialog>
					<AlertDialogTrigger
						render={<Button type="button" variant="outline" size="sm" />}
					>
						{m.profile_vat_cancel_request()}
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{m.profile_vat_cancel_title()}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{m.profile_vat_cancel_description()}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>
								{m.profile_vat_cancel_back()}
							</AlertDialogCancel>
							<AlertDialogAction onClick={() => cancel.mutate()}>
								{m.profile_vat_cancel_request()}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</div>
	);
}
