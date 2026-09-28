import { Button } from "@bibs/ui/components/button";
import { EmptyState } from "@bibs/ui/components/empty-state";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Spinner } from "@bibs/ui/components/spinner";
import { cn } from "@bibs/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PackageIcon, ReceiptIcon } from "lucide-react";
import type { ReactNode } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import { OrderActions } from "@/features/orders/components/order-actions";
import { OrderStatusBadge } from "@/features/orders/components/order-status-badge";
import { OrderVatTable } from "@/features/orders/components/order-vat-table";
import { useOrder } from "@/features/orders/hooks/use-orders";
import {
	canCancel,
	canMarkPickedUp,
	canMarkReady,
	ORDER_TYPE_LABEL,
	reservationTimeLeft,
	shortOrderId,
} from "@/features/orders/order-labels";
import { orderSummaryCents } from "@/features/orders/order-summary";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/orders/$orderId")({
	component: OrderDetailPage,
});

const DATETIME_FMT: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "long",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
};

const toCents = (v: string) => Math.round(Number(v) * 100);

// Stati in cui un pay_pickup è stato effettivamente incassato online.
const PAID_ONLINE_STATUSES = [
	"confirmed",
	"ready_for_pickup",
	"completed",
] as const;

function Card({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-3 rounded-xl border border-border p-4">
			<h2 className="font-display font-semibold text-foreground">{title}</h2>
			{children}
		</section>
	);
}

function OrderDetailPage() {
	const { orderId } = Route.useParams();
	const { data: order, isLoading, isError } = useOrder(orderId);

	if (isLoading) return <Spinner />;
	if (isError || !order)
		return (
			<EmptyState
				title={m.orders_detail_not_found()}
				action={
					<Button asChild variant="secondary">
						<Link
							to="/orders"
							search={{ tab: "all", type: undefined, page: 1, limit: 20 }}
						>
							{m.orders_page_title()}
						</Link>
					</Button>
				}
			/>
		);

	const summary = orderSummaryCents(order);
	const openReservation =
		order.type === "reserve_pickup" &&
		order.reservationExpiresAt &&
		(order.status === "confirmed" || order.status === "ready_for_pickup");
	const left = openReservation
		? reservationTimeLeft(order.reservationExpiresAt as Date)
		: null;
	const address = order.shippingAddressSnapshot;
	const hasActions =
		canMarkReady(order) || canMarkPickedUp(order) || canCancel(order);

	return (
		<div className="@container space-y-6">
			<EntityFormHeader
				icon={ReceiptIcon}
				title={`${m.orders_col_order()} ${shortOrderId(order.id)}`}
				placeholder={m.orders_col_order()}
				subtitle={`${ORDER_TYPE_LABEL[order.type]()} · ${m.orders_detail_created(
					{
						date: new Date(order.createdAt).toLocaleString(
							"it-IT",
							DATETIME_FMT,
						),
					},
				)}`}
				badge={<OrderStatusBadge status={order.status} />}
			/>

			{(openReservation || hasActions) && (
				<div className="flex flex-wrap items-center justify-between gap-3">
					{openReservation && left ? (
						<p
							className={cn(
								"text-sm",
								left.expired ? "text-destructive" : "text-foreground",
							)}
						>
							{m.orders_detail_deadline({
								date: new Date(
									order.reservationExpiresAt as Date,
								).toLocaleString("it-IT", DATETIME_FMT),
							})}{" "}
							<span className="text-muted-foreground">({left.label})</span>
						</p>
					) : (
						<span />
					)}
					<OrderActions order={order} />
				</div>
			)}

			<div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_20rem] @3xl:items-start">
				<Card title={m.orders_detail_items()}>
					<ul className="divide-y divide-border">
						{order.items.map((item) => (
							<li
								key={item.id}
								className="flex gap-3 py-3 first:pt-0 last:pb-0"
							>
								<div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
									{item.productImageUrl ? (
										<img
											src={item.productImageUrl}
											alt=""
											className="size-full object-cover"
										/>
									) : (
										<PackageIcon className="size-5 text-muted-foreground" />
									)}
								</div>
								<div className="min-w-0 flex-1 space-y-0.5">
									<p className="font-medium text-foreground text-sm">
										{item.productName}
									</p>
									{(item.brandName || item.productEan) && (
										<p className="text-muted-foreground text-xs">
											{[item.brandName, item.productEan]
												.filter(Boolean)
												.join(" · ")}
										</p>
									)}
									<p className="text-muted-foreground text-sm tabular-nums">
										{item.quantity} × {formatPriceEur(item.unitPrice)}
										{item.discountPercent && item.listPrice && (
											<>
												{" "}
												<span className="line-through">
													{formatPriceEur(item.listPrice)}
												</span>{" "}
												-{item.discountPercent}%
											</>
										)}
									</p>
								</div>
								<p className="shrink-0 font-medium text-foreground text-sm tabular-nums">
									{formatPriceEur(
										(toCents(item.unitPrice) * item.quantity) / 100,
									)}
								</p>
							</li>
						))}
					</ul>
				</Card>

				<div className="space-y-6">
					<Card title={m.orders_detail_summary()}>
						<dl className="space-y-1 text-sm tabular-nums">
							<div className="flex justify-between">
								<dt className="text-muted-foreground">
									{m.orders_detail_subtotal()}
								</dt>
								<dd>{formatPriceEur(summary.subtotal / 100)}</dd>
							</div>
							{summary.pointsDiscount > 0 && (
								<div className="flex justify-between">
									<dt className="text-muted-foreground">
										{m.orders_detail_points_discount()}
									</dt>
									<dd>−{formatPriceEur(summary.pointsDiscount / 100)}</dd>
								</div>
							)}
							{summary.shipping > 0 && (
								<div className="flex justify-between">
									<dt className="text-muted-foreground">
										{m.orders_detail_shipping()}
									</dt>
									<dd>{formatPriceEur(summary.shipping / 100)}</dd>
								</div>
							)}
							<div className="flex justify-between border-border border-t pt-2 font-semibold text-base">
								<dt>{m.orders_detail_total()}</dt>
								<dd>{formatPriceEur(summary.grandTotal / 100)}</dd>
							</div>
						</dl>
						{order.type === "reserve_pickup" && (
							<p className="text-muted-foreground text-xs">
								{m.orders_detail_to_collect()}
							</p>
						)}
						{order.type === "pay_pickup" &&
							(order.status === "pending" ||
								order.status === "cancelled" ||
								(PAID_ONLINE_STATUSES as readonly string[]).includes(
									order.status,
								)) && (
								<p className="text-muted-foreground text-xs">
									{order.status === "pending"
										? m.orders_detail_awaiting_payment()
										: order.status === "cancelled"
											? m.orders_detail_cancelled_online()
											: m.orders_detail_paid_online()}
								</p>
							)}
					</Card>

					<Card title={m.orders_detail_vat()}>
						<OrderVatTable lines={order.vatBreakdown} />
					</Card>

					<Card title={m.orders_detail_customer()}>
						<p className="text-foreground text-sm">
							{order.customerProfile.user.name}
						</p>
						<a
							href={`mailto:${order.customerProfile.user.email}`}
							className="text-muted-foreground text-sm hover:underline"
						>
							{order.customerProfile.user.email}
						</a>
					</Card>

					{address && (
						<Card title={m.orders_detail_shipping()}>
							<address className="text-foreground text-sm not-italic leading-relaxed">
								{address.recipientName && (
									<>
										{address.recipientName}
										<br />
									</>
								)}
								{address.addressLine1}
								{address.addressLine2 && (
									<>
										<br />
										{address.addressLine2}
									</>
								)}
								<br />
								{address.zipCode} {address.municipalityName} (
								{address.provinceAcronym})
							</address>
						</Card>
					)}
				</div>
			</div>
		</div>
	);
}
