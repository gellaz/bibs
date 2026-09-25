import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { cn } from "@bibs/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, ReceiptText, TriangleAlert } from "lucide-react";
import { Notice } from "@/components/notice";
import { OrderStatusBadge } from "@/features/orders/order-status-badge";
import { PickupCountdown } from "@/features/orders/pickup-countdown";
import {
	ORDERS_PAGE_SIZE,
	useCustomerOrders,
} from "@/features/orders/use-orders";
import { m } from "@/paraglide/messages";

type OrdersTab = "reserved" | "paid";

export const Route = createFileRoute("/_authenticated/orders/")({
	component: OrdersPage,
	validateSearch: (search: Record<string, unknown>) => ({
		tab: (search.tab === "paid" ? "paid" : "reserved") as OrdersTab,
		page: Math.max(1, Number(search.page) || 1),
	}),
});

const TAB_TYPE = { reserved: "reserve_pickup", paid: "pay_pickup" } as const;
const shortId = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;
const DATE_FMT: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "short",
	year: "numeric",
};

function OrdersPage() {
	const { tab, page } = Route.useSearch();
	const { data, isPending, isError, refetch } = useCustomerOrders({
		type: TAB_TYPE[tab],
		page,
	});
	const orders = data?.data ?? [];
	const total = data?.pagination.total ?? 0;
	const pages = Math.ceil(total / ORDERS_PAGE_SIZE);

	return (
		<div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
			<h1 className="font-display font-semibold text-2xl text-foreground">
				{m.orders_title()}
			</h1>

			<nav
				className="flex gap-1 border-border border-b"
				aria-label={m.orders_title()}
			>
				{(["reserved", "paid"] as const).map((t) => (
					<Link
						key={t}
						to="/orders"
						search={{ tab: t, page: 1 }}
						aria-current={t === tab ? "page" : undefined}
						className={cn(
							"-mb-px flex min-h-11 items-center border-b-2 px-3 font-medium text-sm transition-colors",
							t === tab
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{t === "reserved" ? m.orders_tab_reserved() : m.orders_tab_paid()}
					</Link>
				))}
			</nav>

			{isPending ? (
				<div className="space-y-3">
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-24 w-full" />
				</div>
			) : isError ? (
				<Notice
					icon={TriangleAlert}
					title={m.orders_load_failed()}
					description={m.orders_empty_description()}
					action={
						<Button variant="secondary" onClick={() => refetch()}>
							{m.cart_retry()}
						</Button>
					}
				/>
			) : orders.length === 0 ? (
				<Notice
					icon={ReceiptText}
					title={
						tab === "reserved"
							? m.orders_empty_reserved()
							: m.orders_empty_paid()
					}
					description={m.orders_empty_description()}
					action={
						<Button asChild>
							<Link
								to="/stores"
								search={{ q: undefined, categoryId: undefined }}
							>
								{m.cart_empty_cta()}
							</Link>
						</Button>
					}
				/>
			) : (
				<ul className="space-y-3">
					{orders.map((o) => {
						const open =
							o.type === "reserve_pickup" &&
							o.reservationExpiresAt &&
							(o.status === "confirmed" || o.status === "ready_for_pickup");
						const count = o.items.reduce((s, i) => s + i.quantity, 0);
						return (
							<li key={o.id}>
								<Link
									to="/orders/$orderId"
									params={{ orderId: o.id }}
									className="flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50"
								>
									<span className="min-w-0 flex-1 space-y-1">
										<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
											<span className="font-display font-semibold text-foreground">
												{o.store.name}
											</span>
											<OrderStatusBadge status={o.status} />
										</span>
										<span className="block text-muted-foreground text-sm tabular-nums">
											{m.orders_order_number({ number: shortId(o.id) })} ·{" "}
											{new Date(o.createdAt).toLocaleDateString(
												"it-IT",
												DATE_FMT,
											)}{" "}
											·{" "}
											{count === 1
												? m.checkout_items_count_one()
												: m.checkout_items_count({ count })}{" "}
											· {formatPriceEur(o.total)}
										</span>
										{open && o.reservationExpiresAt && (
											<span className="block">
												<PickupCountdown expiresAt={o.reservationExpiresAt} />
											</span>
										)}
									</span>
									<ChevronRight
										className="size-5 shrink-0 text-muted-foreground"
										aria-hidden
									/>
								</Link>
							</li>
						);
					})}
				</ul>
			)}

			{pages > 1 && (
				<div className="flex justify-between">
					{page > 1 ? (
						<Button asChild variant="secondary" className="min-h-11">
							<Link to="/orders" search={{ tab, page: page - 1 }}>
								←
							</Link>
						</Button>
					) : (
						<span />
					)}
					{page < pages && (
						<Button asChild variant="secondary" className="min-h-11">
							<Link to="/orders" search={{ tab, page: page + 1 }}>
								→
							</Link>
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
