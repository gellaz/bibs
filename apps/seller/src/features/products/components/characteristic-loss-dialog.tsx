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
} from "@bibs/ui/components/alert-dialog";
import { m } from "@/paraglide/messages";
import {
	lossConfirmation,
	type SavedCharacteristicValue,
} from "../lib/characteristic-form";

interface Props {
	lost: SavedCharacteristicValue[];
	open: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}

export function CharacteristicLossDialog({
	lost,
	open,
	onCancel,
	onConfirm,
}: Props) {
	return (
		<AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogMedia variant="destructive" />
					<AlertDialogTitle>
						{m.products_characteristics_loss_dialog_title()}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{lossConfirmation(lost)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={onConfirm}>
						{m.products_characteristics_loss_dialog_confirm()}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
