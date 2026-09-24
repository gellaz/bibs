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
import {
	filledPhrase,
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
					<AlertDialogTitle>Cambiare sotto-categoria?</AlertDialogTitle>
					<AlertDialogDescription>
						Cambiando categoria perderai {filledPhrase(lost.length)}:{" "}
						{lost.map((v) => v.name).join(", ")}.{" "}
						{lost.length === 1
							? "Non si potrà recuperare."
							: "Non si potranno recuperare."}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Annulla</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={onConfirm}>
						Salva ed elimina
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
