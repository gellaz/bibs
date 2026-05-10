import { Button } from "@bibs/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { Link } from "@tanstack/react-router";
import {
	EyeIcon,
	EyeOffIcon,
	MoreHorizontalIcon,
	PencilIcon,
	RotateCcwIcon,
	Trash2Icon,
	TrashIcon,
} from "lucide-react";
import { useState } from "react";
import { ConfirmPermanentDeleteDialog } from "@/features/products/components/confirm-permanent-delete-dialog";
import { useProductMutations } from "@/features/products/hooks/use-product-mutations";
import { m } from "@/paraglide/messages";

type ProductStatus = "active" | "disabled" | "trashed";

interface Props {
	productId: string;
	status: ProductStatus;
	activeStoreId: string;
}

export function ProductRowActions({ productId, status, activeStoreId }: Props) {
	const { setStatus } = useProductMutations(activeStoreId);
	const [confirmOpen, setConfirmOpen] = useState(false);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon">
						<MoreHorizontalIcon className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{status !== "trashed" && (
						<DropdownMenuItem asChild className="whitespace-nowrap">
							<Link to="/products/$productId" params={{ productId }}>
								<PencilIcon />
								{m.products_action_edit()}
							</Link>
						</DropdownMenuItem>
					)}

					{status === "active" && (
						<DropdownMenuItem
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
		</>
	);
}
