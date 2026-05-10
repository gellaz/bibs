import { Button } from "@bibs/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { Link } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
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
						<DropdownMenuItem asChild>
							<Link to="/products/$productId" params={{ productId }}>
								{m.products_action_edit()}
							</Link>
						</DropdownMenuItem>
					)}

					{status === "active" && (
						<DropdownMenuItem
							onSelect={() =>
								setStatus.mutate({
									productId,
									status: "disabled",
									previousStatus: "active",
								})
							}
						>
							{m.products_action_disable()}
						</DropdownMenuItem>
					)}

					{status === "disabled" && (
						<DropdownMenuItem
							onSelect={() =>
								setStatus.mutate({
									productId,
									status: "active",
									previousStatus: "disabled",
								})
							}
						>
							{m.products_action_enable()}
						</DropdownMenuItem>
					)}

					{status === "trashed" && (
						<DropdownMenuItem
							onSelect={() =>
								setStatus.mutate({
									productId,
									status: "active",
									previousStatus: "trashed",
								})
							}
						>
							{m.products_action_restore()}
						</DropdownMenuItem>
					)}

					<DropdownMenuSeparator />

					{status !== "trashed" ? (
						<DropdownMenuItem
							variant="destructive"
							onSelect={() =>
								setStatus.mutate({
									productId,
									status: "trashed",
									previousStatus: status,
								})
							}
						>
							{m.products_action_trash()}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							variant="destructive"
							onSelect={() => setConfirmOpen(true)}
						>
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
