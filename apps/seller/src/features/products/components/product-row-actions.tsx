import { Button } from "@bibs/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { toast } from "@bibs/ui/components/sonner";
import { Link } from "@tanstack/react-router";
import {
	CopyIcon,
	CopyPlusIcon,
	EyeIcon,
	EyeOffIcon,
	MoreHorizontalIcon,
	PencilIcon,
	RotateCcwIcon,
	TagIcon,
	Trash2Icon,
	TrashIcon,
} from "lucide-react";
import { useState } from "react";
import { ApplyPromotionDialog } from "@/features/products/components/apply-promotion-dialog";
import { ConfirmPermanentDeleteDialog } from "@/features/products/components/confirm-permanent-delete-dialog";
import { StoreAssignmentDialog } from "@/features/products/components/store-assignment-dialog";
import { useProductMutations } from "@/features/products/hooks/use-product-mutations";
import { m } from "@/paraglide/messages";

type ProductStatus = "active" | "disabled" | "trashed";

interface Props {
	productId: string;
	status: ProductStatus;
	activeStoreId: string;
	assignedStoreIds: string[];
}

export function ProductRowActions({
	productId,
	status,
	activeStoreId,
	assignedStoreIds,
}: Props) {
	const { setStatus } = useProductMutations(activeStoreId);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [addStoreOpen, setAddStoreOpen] = useState(false);
	const [applyPromoOpen, setApplyPromoOpen] = useState(false);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon">
						<MoreHorizontalIcon className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-auto">
					{status !== "trashed" && (
						<DropdownMenuItem asChild className="whitespace-nowrap">
							<Link to="/products/$productId" params={{ productId }}>
								<PencilIcon />
								{m.products_action_edit()}
							</Link>
						</DropdownMenuItem>
					)}

					{status !== "trashed" && (
						<DropdownMenuItem
							className="whitespace-nowrap"
							onSelect={() => setAddStoreOpen(true)}
						>
							<CopyPlusIcon />
							{m.products_action_add_to_store()}
						</DropdownMenuItem>
					)}

					{status === "active" && (
						<DropdownMenuItem
							className="whitespace-nowrap"
							onSelect={() => setApplyPromoOpen(true)}
						>
							<TagIcon />
							{m.products_apply_promotion_action()}
						</DropdownMenuItem>
					)}

					<DropdownMenuItem
						className="whitespace-nowrap"
						onSelect={async () => {
							try {
								await navigator.clipboard.writeText(productId);
								toast.success(m.products_action_copy_id_success());
							} catch {
								toast.error(m.products_action_copy_id_error());
							}
						}}
					>
						<CopyIcon />
						{m.products_action_copy_id()}
					</DropdownMenuItem>

					{status === "disabled" && (
						<DropdownMenuItem
							className="whitespace-nowrap"
							onSelect={() =>
								setStatus.mutate({
									productId,
									status: "active",
									previousStatus: "disabled",
								})
							}
						>
							<EyeIcon />
							{m.products_action_enable()}
						</DropdownMenuItem>
					)}

					{status === "trashed" && (
						<DropdownMenuItem
							className="whitespace-nowrap"
							onSelect={() =>
								setStatus.mutate({
									productId,
									status: "active",
									previousStatus: "trashed",
								})
							}
						>
							<RotateCcwIcon />
							{m.products_action_restore()}
						</DropdownMenuItem>
					)}

					<DropdownMenuSeparator />

					{status === "active" && (
						<DropdownMenuItem
							variant="warning"
							className="whitespace-nowrap"
							onSelect={() =>
								setStatus.mutate({
									productId,
									status: "disabled",
									previousStatus: "active",
								})
							}
						>
							<EyeOffIcon />
							{m.products_action_disable()}
						</DropdownMenuItem>
					)}

					{status !== "trashed" ? (
						<DropdownMenuItem
							variant="destructive"
							className="whitespace-nowrap"
							onSelect={() =>
								setStatus.mutate({
									productId,
									status: "trashed",
									previousStatus: status,
								})
							}
						>
							<Trash2Icon />
							{m.products_action_trash()}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							variant="destructive"
							className="whitespace-nowrap"
							onSelect={() => setConfirmOpen(true)}
						>
							<TrashIcon />
							{m.products_action_delete_permanent()}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<ConfirmPermanentDeleteDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				productIds={[productId]}
				activeStoreId={activeStoreId}
			/>

			<StoreAssignmentDialog
				productId={productId}
				assignedStoreIds={assignedStoreIds}
				open={addStoreOpen}
				onOpenChange={setAddStoreOpen}
			/>

			<ApplyPromotionDialog
				open={applyPromoOpen}
				onOpenChange={setApplyPromoOpen}
				productIds={[productId]}
			/>
		</>
	);
}
