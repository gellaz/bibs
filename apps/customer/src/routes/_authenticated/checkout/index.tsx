import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { NoticePage } from "@/components/notice";
import { useCart } from "@/features/cart/use-cart";
import { buyableGroups } from "@/features/checkout/buyable";
import {
	parseChoice,
	resolveChoice,
	serializeChoice,
} from "@/features/checkout/checkout-choice";
import { StoreChoice } from "@/features/checkout/store-choice";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/checkout/")({
	component: CheckoutChoicePage,
	validateSearch: (search: Record<string, unknown>) => ({
		choice: typeof search.choice === "string" ? search.choice : undefined,
	}),
});

function itemsLabel(count: number) {
	return count === 1
		? m.checkout_items_count_one()
		: m.checkout_items_count({ count });
}

function CheckoutChoicePage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { cart, isPending } = useCart();

	if (isPending)
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-40 w-full" />
			</div>
		);

	const groups = buyableGroups(cart);
	if (groups.length === 0)
		return (
			<NoticePage
				icon={ShoppingBag}
				title={m.cart_empty_title()}
				description={m.cart_empty_description()}
				action={
					<Button asChild>
						<Link to="/cart">{m.checkout_back_to_cart()}</Link>
					</Button>
				}
			/>
		);

	const { choice, complete } = resolveChoice(
		groups,
		parseChoice(search.choice),
	);

	return (
		<div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6">
			<header className="space-y-1">
				<h1 className="font-display font-semibold text-2xl text-foreground">
					{m.checkout_choose_title()}
				</h1>
				<p className="text-muted-foreground text-sm">
					{m.checkout_choose_subtitle()}
				</p>
			</header>

			{groups.map((group) => {
				const count = group.items.reduce((s, i) => s + i.quantity, 0);
				return (
					<section
						key={group.store.id}
						className="space-y-3 rounded-xl border border-border p-4"
					>
						<div className="flex flex-wrap items-baseline justify-between gap-x-3">
							<h2 className="font-display font-semibold text-foreground text-lg">
								{group.store.name}
							</h2>
							<span className="text-muted-foreground text-sm">
								{group.store.municipality.name} (
								{group.store.municipality.provinceAcronym})
							</span>
						</div>
						<p className="text-muted-foreground text-sm tabular-nums">
							{itemsLabel(count)} · {formatPriceEur(group.subtotal)}
						</p>
						<StoreChoice
							storeId={group.store.id}
							options={group.store.orderTypes}
							value={choice[group.store.id]}
							onChange={(type) =>
								void navigate({
									search: {
										choice: serializeChoice({
											...choice,
											[group.store.id]: type,
										}),
									},
									replace: true,
								})
							}
						/>
					</section>
				);
			})}

			<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
				<Button asChild variant="secondary" className="min-h-11">
					<Link to="/cart">{m.checkout_back_to_cart()}</Link>
				</Button>
				{complete ? (
					<Button asChild size="lg" className="min-h-11">
						<Link
							to="/checkout/review"
							search={{ choice: serializeChoice(choice) }}
						>
							{m.checkout_next()}
						</Link>
					</Button>
				) : (
					<Button size="lg" className="min-h-11" disabled>
						{m.checkout_next()}
					</Button>
				)}
			</div>
		</div>
	);
}
