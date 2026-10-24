import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { formatPriceEur } from "@bibs/ui/custom/price";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { cn } from "@bibs/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { EmptyPanel, exploreActions } from "@/components/empty-panel";
import { Notice } from "@/components/notice";
import { PAGE_CONTAINER } from "@/components/page";
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
// Sotto `lg` una card per riga; poi due (tre da `2xl`), così la riga dei dati
// (numero · data · articoli · totale) non va mai a capo.
const LIST_GRID = "grid gap-3 lg:grid-cols-2 2xl:grid-cols-3";
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
		<div className={`${PAGE_CONTAINER} space-y-6 py-8 sm:py-10`}>
			<section className="space-y-1">
				<h1 className="font-bold font-display text-2xl text-primary tracking-[-0.015em]">
					{m.orders_title()}
				</h1>
				<p className="text-muted-foreground text-sm">{m.orders_subtitle()}</p>
			</section>

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
				<div className={LIST_GRID}>
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
				<EmptyPanel
					title={
						tab === "reserved"
							? m.orders_empty_reserved()
							: m.orders_empty_paid()
					}
					description={m.orders_empty_description()}
					{...exploreActions()}
				/>
			) : (
				<ul className={LIST_GRID}>
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
									className="flex h-full items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50"
								>
									<span className="min-w-0 flex-1 space-y-1">
										<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
											<span className="font-medium text-[0.9375rem] text-foreground leading-snug">
												{o.store.name}
											</span>
											<OrderStatusBadge status={o.status} />
										</span>
										<span className="block text-muted-foreground text-sm tabular-nums">
											{m.orders_order_number({ number: shortId(o.id) })} ·{" "}
											{new Date(o.createdAt).toLocaleDateString(
												intlLocale(),
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
						<Button
							variant="secondary"
							className="min-h-11"
							nativeButton={false}
							render={<Link to="/orders" search={{ tab, page: page - 1 }} />}
						>
							←
						</Button>
					) : (
						<span />
					)}
					{page < pages && (
						<Button
							variant="secondary"
							className="min-h-11"
							nativeButton={false}
							render={<Link to="/orders" search={{ tab, page: page + 1 }} />}
						>
							→
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
