import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@bibs/ui/components/field";
import { Textarea } from "@bibs/ui/components/textarea";
import { useState } from "react";
import { m } from "@/paraglide/messages";

/** Dialog di rifiuto: il motivo è obbligatorio (max 500, come l'API). */
export function RejectChangeDialog({
	open,
	onOpenChange,
	onConfirm,
	isPending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (reason: string) => void;
	isPending: boolean;
}) {
	const [reason, setReason] = useState("");
	const trimmed = reason.trim();

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{m.request_detail_reject_title()}</AlertDialogTitle>
				</AlertDialogHeader>
				<Field>
					<FieldLabel htmlFor="reject-change-reason">
						{m.request_detail_reject_reason()}
					</FieldLabel>
					<Textarea
						id="reject-change-reason"
						maxLength={500}
						value={reason}
						onChange={(e) => setReason(e.target.value)}
					/>
					<FieldDescription>{m.request_detail_reject_hint()}</FieldDescription>
				</Field>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>
						{m.common_cancel()}
					</AlertDialogCancel>
					<Button
						variant="destructive"
						disabled={isPending || !trimmed}
						onClick={() => onConfirm(trimmed)}
					>
						{isPending ? m.common_please_wait() : m.sellers_reject()}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
