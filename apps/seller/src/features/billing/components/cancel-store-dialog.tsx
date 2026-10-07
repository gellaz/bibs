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
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, unwrap } from "@/lib/api";
import { richMessage } from "@/lib/rich-message";
import { m } from "@/paraglide/messages";

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
			return unwrap(r, m.common_error()).data;
		},
		onSuccess: (data) => {
			void qc.invalidateQueries({ queryKey: ["seller", "billing"] });
			void qc.invalidateQueries({ queryKey: ["stores"] });
			if ((data as any)?.status === "canceled") {
				toast.success(m.billing_cancel_archived_toast({ store: storeName }));
			} else {
				toast.success(m.billing_cancel_scheduled_toast({ store: storeName }));
			}
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const isSuspended = status === "suspended";
	const periodEndDate = new Intl.DateTimeFormat(intlLocale(), {
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
							? m.billing_cancel_title_suspended({ store: storeName })
							: m.billing_cancel_title({ store: storeName })}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{isSuspended
							? richMessage(
									m.billing_cancel_description_suspended({
										archived: "{archived}",
									}),
									{
										archived: (
											<strong>{m.billing_cancel_archived_now()}</strong>
										),
									},
								)
							: richMessage(
									(status === "past_due"
										? m.billing_cancel_description_past_due
										: m.billing_cancel_description)({ date: "{date}" }),
									{ date: <strong>{periodEndDate}</strong> },
								)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => cancelMutation.mutate()}
						disabled={cancelMutation.isPending}
					>
						{isSuspended
							? m.billing_cancel_confirm_suspended()
							: m.billing_cancel_confirm()}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
