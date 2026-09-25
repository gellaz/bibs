import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, SearchX } from "lucide-react";
import { NoticePage } from "@/components/notice";
import { useCheckout } from "@/features/checkout/use-checkout";
import { formatPickupCode } from "@/features/orders/pickup-code";
import { PickupCountdown } from "@/features/orders/pickup-countdown";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/checkout/$checkoutId/")({
	component: CheckoutDonePage,
});

const shortId = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;

function CheckoutDonePage() {
	const { checkoutId } = Route.useParams();
	const { data, isPending, isError } = useCheckout(checkoutId);

	if (isPending)
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6">
				<Skeleton className="h-10 w-72" />
				<Skeleton className="h-40 w-full" />
			</div>
		);

	if (isError || !data)
		return (
			<NoticePage
				icon={SearchX}
				title={m.checkout_not_found()}
				description={m.orders_empty_description()}
				action={
					<Button asChild>
						<Link to="/orders" search={{ tab: "reserved", page: 1 }}>
							{m.checkout_done_orders_cta()}
						</Link>
					</Button>
				}
			/>
		);

	return (
		<div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6">
			<header className="flex items-start gap-4">
				<div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-saffron/15">
					<CheckCircle2 className="size-6 text-saffron-deep" aria-hidden />
				</div>
				<div className="space-y-1">
					<h1 className="font-display font-semibold text-2xl text-foreground">
						{data.orders.length > 1
							? m.checkout_done_title_many()
							: m.checkout_done_title()}
					</h1>
					<p className="text-muted-foreground text-sm">
						{m.checkout_done_subtitle()}
					</p>
				</div>
			</header>

			<ul className="space-y-4">
				{data.orders.map((o) => (
					<li
						key={o.id}
						className="space-y-3 rounded-xl border border-border p-4"
					>
						<div className="flex flex-wrap items-baseline justify-between gap-x-3">
							<h2 className="font-display font-semibold text-foreground text-lg">
								{o.store.name}
							</h2>
							<span className="text-muted-foreground text-sm tabular-nums">
								{m.orders_order_number({ number: shortId(o.id) })}
							</span>
						</div>
						<p className="text-muted-foreground text-sm">
							{o.store.addressLine1}, {o.store.zipCode}{" "}
							{o.store.municipality.name} (
							{o.store.municipality.provinceAcronym})
						</p>
						{o.pickupCode && (
							<div className="flex flex-wrap items-baseline justify-between gap-x-3">
								<span className="text-sm">
									<span className="text-muted-foreground">
										{m.orders_pickup_code_label()}
									</span>{" "}
									<span className="font-mono font-semibold text-foreground tracking-widest">
										{formatPickupCode(o.pickupCode)}
									</span>
								</span>
								<Link
									to="/orders/$orderId"
									params={{ orderId: o.id }}
									className="inline-flex min-h-11 items-center font-medium text-sm text-primary hover:underline"
								>
									{m.orders_show_qr()}
								</Link>
							</div>
						)}
						<ul className="space-y-0.5 text-foreground text-sm">
							{o.items.map((i) => (
								<li key={i.id}>
									{i.quantity} × {i.productName}
								</li>
							))}
						</ul>
						<div className="flex flex-wrap items-baseline justify-between gap-x-3 border-border border-t pt-3">
							{o.type === "reserve_pickup" && o.reservationExpiresAt ? (
								<PickupCountdown expiresAt={o.reservationExpiresAt} />
							) : (
								<span />
							)}
							<span className="text-sm">
								<span className="text-muted-foreground">
									{o.type === "reserve_pickup"
										? m.orders_total_in_store()
										: m.orders_total()}
								</span>{" "}
								<span className="font-semibold text-foreground tabular-nums">
									{formatPriceEur(o.total)}
								</span>
							</span>
						</div>
					</li>
				))}
			</ul>

			<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
				<Button asChild variant="secondary" className="min-h-11">
					<Link to="/stores" search={{ q: undefined, categoryId: undefined }}>
						{m.checkout_done_continue()}
					</Link>
				</Button>
				<Button asChild size="lg" className="min-h-11">
					<Link to="/orders" search={{ tab: "reserved", page: 1 }}>
						{m.checkout_done_orders_cta()}
					</Link>
				</Button>
			</div>
		</div>
	);
}
