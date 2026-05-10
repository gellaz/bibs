import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { useProductMutations } from "@/features/products/hooks/use-product-mutations";
import { m } from "@/paraglide/messages";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	productIds: string[];
	activeStoreId: string;
	onSuccess?: () => void;
}

export function ConfirmPermanentDeleteDialog({
	open,
	onOpenChange,
	productIds,
	activeStoreId,
	onSuccess,
}: Props) {
	const { bulkDeletePermanent } = useProductMutations(activeStoreId);

	const handleConfirm = () => {
		bulkDeletePermanent.mutate(
			{ productIds },
			{
				onSuccess: () => {
					onOpenChange(false);
					onSuccess?.();
				},
			},
		);
	};

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{m.products_confirm_delete_title({
							count: productIds.length,
						})}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{m.products_confirm_delete_description()}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>
						{m.products_confirm_delete_cancel()}
					</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={handleConfirm}>
						{m.products_confirm_delete_action()}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
