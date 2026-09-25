import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { toast } from "@bibs/ui/components/sonner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { NoticePage } from "@/components/notice";
import { TileImage } from "@/components/tile";
import { canCustomerCancel } from "@/features/orders/order-display";
import { OrderStatusBadge } from "@/features/orders/order-status-badge";
import { PickupCountdown } from "@/features/orders/pickup-countdown";
import { PickupQr } from "@/features/orders/pickup-qr";
import { useCancelOrder, useCustomerOrder } from "@/features/orders/use-orders";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/orders/$orderId")({
	component: OrderDetailPage,
});

const shortId = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;
const DATETIME_FMT: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "long",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
};
const toCents = (v: string) => Math.round(Number(v) * 100);

function OrderDetailPage() {
	const { orderId } = Route.useParams();
	const { data: order, isPending, isError } = useCustomerOrder(orderId);
	const cancel = useCancelOrder();

	if (isPending)
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="h-48 w-full" />
			</div>
		);

	if (isError || !order)
		return (
			<NoticePage
				icon={SearchX}
				title={m.orders_not_found()}
				description={m.orders_empty_description()}
				action={
					<Button asChild>
						<Link to="/orders" search={{ tab: "reserved", page: 1 }}>
							{m.orders_title()}
						</Link>
					</Button>
				}
			/>
		);

	const open =
		order.type === "reserve_pickup" &&
		order.reservationExpiresAt &&
		(order.status === "confirmed" || order.status === "ready_for_pickup");
	const pickupCode =
		order.status === "confirmed" || order.status === "ready_for_pickup"
			? order.pickupCode
			: null;
	const paid = order.type === "pay_pickup";

	return (
		<div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
			<header className="space-y-2">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<h1 className="font-display font-semibold text-2xl text-foreground tabular-nums">
						{m.orders_order_number({ number: shortId(order.id) })}
					</h1>
					<OrderStatusBadge status={order.status} />
				</div>
				<p className="text-muted-foreground text-sm">
					{new Date(order.createdAt).toLocaleString("it-IT", DATETIME_FMT)}
				</p>
				{open && order.reservationExpiresAt && (
					<PickupCountdown expiresAt={order.reservationExpiresAt} />
				)}
			</header>

			{pickupCode && (
				<section className="space-y-3 rounded-xl border border-border p-4">
					<PickupQr code={pickupCode} />
					<p className="text-center text-muted-foreground text-sm">
						{m.orders_pickup_qr_hint()}
					</p>
				</section>
			)}

			<section className="space-y-2 rounded-xl border border-border p-4">
				<h2 className="font-medium text-muted-foreground text-sm">
					{m.orders_store()}
				</h2>
				<Link
					to="/stores/$storeId"
					params={{ storeId: order.store.id }}
					className="font-display font-semibold text-foreground text-lg hover:underline"
				>
					{order.store.name}
				</Link>
				<p className="text-foreground text-sm">
					{order.store.addressLine1}, {order.store.zipCode}{" "}
					{order.store.municipality.name} (
					{order.store.municipality.provinceAcronym})
				</p>
			</section>

			<section className="space-y-3 rounded-xl border border-border p-4">
				<h2 className="font-medium text-muted-foreground text-sm">
					{m.orders_items()}
				</h2>
				<ul className="divide-y divide-border">
					{order.items.map((item) => (
						<li key={item.id} className="flex items-center gap-3 py-2">
							<div className="size-12 shrink-0 overflow-hidden rounded-lg border border-border">
								<TileImage url={item.productImageUrl} name={item.productName} />
							</div>
							<div className="min-w-0 flex-1">
								<p className="line-clamp-2 text-foreground text-sm">
									{item.productName}
								</p>
								<p className="text-muted-foreground text-xs tabular-nums">
									{item.quantity} × {formatPriceEur(item.unitPrice)}
								</p>
							</div>
							<span className="shrink-0 font-medium text-foreground text-sm tabular-nums">
								{formatPriceEur(
									(toCents(item.unitPrice) * item.quantity) / 100,
								)}
							</span>
						</li>
					))}
				</ul>
				<div className="flex items-baseline justify-between border-border border-t pt-3">
					<span className="font-medium text-foreground">
						{order.type === "reserve_pickup"
							? m.orders_total_in_store()
							: m.orders_total()}
					</span>
					<span className="font-semibold text-foreground text-xl tabular-nums">
						{formatPriceEur(order.total)}
					</span>
				</div>
			</section>

			{order.type === "pay_pickup" &&
				order.status === "pending" &&
				order.checkoutId && (
					<Button asChild size="lg" className="min-h-11">
						<Link
							to="/checkout/$checkoutId/pay"
							params={{ checkoutId: order.checkoutId }}
						>
							{m.orders_complete_payment()}
						</Link>
					</Button>
				)}

			{canCustomerCancel(order) && (
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button
							variant="ghost"
							className="min-h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
							disabled={cancel.isPending}
						>
							{paid ? m.orders_cancel_paid() : m.orders_cancel()}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{paid ? m.orders_cancel_paid_title() : m.orders_cancel_title()}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{paid
									? m.orders_cancel_paid_description({
											amount: formatPriceEur(order.total),
										})
									: m.orders_cancel_description()}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{m.orders_cancel_keep()}</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() =>
									cancel.mutate(order.id, {
										onSuccess: () =>
											toast.success(
												paid
													? m.orders_cancel_paid_success()
													: m.orders_cancel_success(),
											),
									})
								}
							>
								{paid ? m.orders_cancel_paid() : m.orders_cancel_confirm()}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</div>
	);
}
