import { Button } from "@bibs/ui/components/button";
import {
	EyeIcon,
	EyeOffIcon,
	RotateCcwIcon,
	Trash2Icon,
	TrashIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { ConfirmPermanentDeleteDialog } from "@/features/products/components/confirm-permanent-delete-dialog";
import type { ProductStatusFilter } from "@/features/products/components/product-status-tabs";
import { useProductMutations } from "@/features/products/hooks/use-product-mutations";
import { m } from "@/paraglide/messages";

interface Props {
	selectedIds: string[];
	activeStoreId: string;
	statusFilter: ProductStatusFilter;
	onClear: () => void;
}

export function ProductBulkToolbar({
	selectedIds,
	activeStoreId,
	statusFilter,
	onClear,
}: Props) {
	const { bulkSetStatus } = useProductMutations(activeStoreId);
	const [confirmOpen, setConfirmOpen] = useState(false);

	if (selectedIds.length === 0) return null;

	const apply = (status: "active" | "disabled" | "trashed") => () => {
		bulkSetStatus.mutate(
			{ productIds: selectedIds, status },
			{ onSuccess: () => onClear() },
		);
	};

	return (
		<>
			<div className="bg-card sticky top-0 z-10 flex items-center gap-3 rounded-lg border px-4 py-2.5 shadow-sm">
				<span
					aria-hidden
					className="bg-primary size-1.5 shrink-0 rounded-full"
				/>
				<span className="text-sm font-medium">
					{m.products_bulk_selected({ count: selectedIds.length })}
				</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={onClear}
					className="text-muted-foreground hover:text-foreground -ml-1 h-7 px-2"
				>
					<XIcon className="size-3.5" />
					{m.products_bulk_clear_selection()}
				</Button>
				<div className="ml-auto flex gap-2">
					{statusFilter === "active" && (
						<>
							<Button size="sm" onClick={apply("disabled")}>
								<EyeOffIcon className="size-4" />
								{m.products_action_disable()}
							</Button>
							<Button
								size="sm"
								variant="destructive"
								onClick={apply("trashed")}
							>
								<Trash2Icon className="size-4" />
								{m.products_action_trash()}
							</Button>
						</>
					)}
					{statusFilter === "disabled" && (
						<>
							<Button size="sm" onClick={apply("active")}>
								<EyeIcon className="size-4" />
								{m.products_action_enable()}
							</Button>
							<Button
								size="sm"
								variant="destructive"
								onClick={apply("trashed")}
							>
								<Trash2Icon className="size-4" />
								{m.products_action_trash()}
							</Button>
						</>
					)}
					{statusFilter === "trashed" && (
						<>
							<Button size="sm" onClick={apply("active")}>
								<RotateCcwIcon className="size-4" />
								{m.products_action_restore()}
							</Button>
							<Button
								size="sm"
								variant="destructive"
								onClick={() => setConfirmOpen(true)}
							>
								<TrashIcon className="size-4" />
								{m.products_action_delete_permanent()}
							</Button>
						</>
					)}
				</div>
			</div>

			<ConfirmPermanentDeleteDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				productIds={selectedIds}
				activeStoreId={activeStoreId}
				onSuccess={onClear}
			/>
		</>
	);
}
