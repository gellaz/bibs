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
import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { useState } from "react";
import { m } from "@/paraglide/messages";
import {
	useCancelOrder,
	useMarkPickedUp,
	useMarkReady,
} from "../hooks/use-orders";
import {
	canCancel,
	canMarkPickedUp,
	canMarkReady,
	type OrderStatus,
	type OrderType,
} from "../order-labels";

interface Props {
	order: { id: string; status: OrderStatus; type: OrderType };
}

type Confirm = "picked_up" | "cancel" | null;

/** Azioni del negozio sull'ordine. «Pronto» è diretto: non tocca soldi né
 *  stock. Ritiro e annullamento chiedono conferma. */
export function OrderActions({ order }: Props) {
	const markReady = useMarkReady();
	const markPickedUp = useMarkPickedUp();
	const cancel = useCancelOrder();
	const [confirm, setConfirm] = useState<Confirm>(null);

	const busy =
		markReady.isPending || markPickedUp.isPending || cancel.isPending;
	const onError = (e: Error) => toast.error(e.message);

	const showReady = canMarkReady(order);
	const showPickedUp = canMarkPickedUp(order);
	const showCancel = canCancel(order);
	if (!showReady && !showPickedUp && !showCancel) return null;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{showCancel && (
				<Button
					variant="ghost"
					className="text-destructive hover:bg-destructive/10 hover:text-destructive"
					disabled={busy}
					onClick={() => setConfirm("cancel")}
				>
					{m.orders_action_cancel()}
				</Button>
			)}
			{showReady && (
				<Button
					variant={showPickedUp ? "secondary" : "default"}
					disabled={busy}
					onClick={() =>
						markReady.mutate(order.id, {
							onSuccess: () => toast.success(m.orders_ready_success()),
							onError,
						})
					}
				>
					{m.orders_action_ready()}
				</Button>
			)}
			{showPickedUp && (
				<Button disabled={busy} onClick={() => setConfirm("picked_up")}>
					{m.orders_action_picked_up()}
				</Button>
			)}

			<AlertDialog
				open={confirm !== null}
				onOpenChange={(open) => !open && setConfirm(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						{confirm === "cancel" && <AlertDialogMedia variant="destructive" />}
						<AlertDialogTitle>
							{confirm === "cancel"
								? m.orders_cancel_title()
								: m.orders_picked_up_title()}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirm === "cancel"
								? m.orders_cancel_description()
								: order.type === "reserve_pickup"
									? m.orders_picked_up_description_reserve()
									: m.orders_picked_up_description()}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							{confirm === "cancel"
								? m.orders_cancel_keep()
								: m.orders_picked_up_back()}
						</AlertDialogCancel>
						{confirm === "cancel" ? (
							<AlertDialogAction
								variant="destructive"
								onClick={() =>
									cancel.mutate(order.id, {
										onSuccess: () => toast.success(m.orders_cancel_success()),
										onError,
									})
								}
							>
								{m.orders_cancel_confirm()}
							</AlertDialogAction>
						) : (
							<AlertDialogAction
								onClick={() =>
									markPickedUp.mutate(order.id, {
										onSuccess: () =>
											toast.success(m.orders_picked_up_success()),
										onError,
									})
								}
							>
								{m.orders_picked_up_confirm()}
							</AlertDialogAction>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
