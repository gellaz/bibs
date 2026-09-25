import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { toast } from "@bibs/ui/components/sonner";
import {
	createFileRoute,
	Link,
	Navigate,
	useNavigate,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { TileImage } from "@/components/tile";
import { useCart } from "@/features/cart/use-cart";
import { buyableGroups } from "@/features/checkout/buyable";
import {
	confirmLabel,
	parseChoice,
	resolveChoice,
	serializeChoice,
} from "@/features/checkout/checkout-choice";
import { checkoutTypeLabel } from "@/features/checkout/store-choice";
import { useCreateCheckout } from "@/features/checkout/use-checkout";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/checkout/review")({
	component: CheckoutReviewPage,
	validateSearch: (search: Record<string, unknown>) => ({
		choice: typeof search.choice === "string" ? search.choice : undefined,
	}),
});

const RESERVATION_HOURS = 48;
const toCents = (v: string) => Math.round(Number(v) * 100);

function CheckoutReviewPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const { cart, isPending } = useCart();
	const createCheckout = useCreateCheckout();
	// Stabile per tutta la vita della pagina: un doppio click o un retry di rete
	// riusano la stessa key e l'API restituisce lo stesso checkout.
	const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

	if (isPending)
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-56 w-full" />
			</div>
		);

	const groups = buyableGroups(cart);
	const { choice, complete } = resolveChoice(
		groups,
		parseChoice(search.choice),
	);
	// Dopo la conferma il carrello si svuota: non rimbalzare sulla scelta.
	if (!complete && !createCheckout.isPending && !createCheckout.isSuccess)
		return (
			<Navigate
				to="/checkout"
				search={{ choice: serializeChoice(choice) }}
				replace
			/>
		);

	const types = groups.map((g) => choice[g.store.id]);
	const sumFor = (type: string) =>
		groups
			.filter((g) => choice[g.store.id] === type)
			.reduce((s, g) => s + toCents(g.subtotal), 0);
	const payNow = sumFor("pay_pickup");
	const payInStore = sumFor("reserve_pickup");

	const confirm = () =>
		createCheckout.mutate(
			{
				idempotencyKey,
				stores: groups.map((g) => ({
					storeId: g.store.id,
					type: choice[g.store.id],
				})),
			},
			{
				onSuccess: (data) =>
					void navigate({
						to: "/checkout/$checkoutId",
						params: { checkoutId: data.id },
						replace: true,
					}),
				onError: (e) => {
					toast.error(e.message || m.checkout_cart_changed());
					void navigate({ to: "/cart" });
				},
			},
		);

	return (
		<div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6">
			<h1 className="font-display font-semibold text-2xl text-foreground">
				{m.checkout_review_title()}
			</h1>

			{groups.map((group) => (
				<section
					key={group.store.id}
					className="space-y-3 rounded-xl border border-border p-4"
				>
					<div className="flex flex-wrap items-baseline justify-between gap-x-3">
						<h2 className="font-display font-semibold text-foreground text-lg">
							{group.store.name}
						</h2>
						<span className="text-muted-foreground text-sm">
							{checkoutTypeLabel(choice[group.store.id])}
						</span>
					</div>
					<ul className="divide-y divide-border">
						{group.items.map((item) => (
							<li key={item.id} className="flex items-center gap-3 py-2">
								<div className="size-12 shrink-0 overflow-hidden rounded-lg border border-border">
									<TileImage
										url={item.product.imageUrl}
										name={item.product.name}
									/>
								</div>
								<div className="min-w-0 flex-1">
									<p className="line-clamp-2 text-foreground text-sm">
										{item.product.name}
									</p>
									<p className="text-muted-foreground text-xs tabular-nums">
										{item.quantity} ×{" "}
										{formatPriceEur(item.discountedPrice ?? item.unitPrice)}
									</p>
								</div>
								<span className="shrink-0 font-medium text-foreground text-sm tabular-nums">
									{formatPriceEur(item.lineTotal)}
								</span>
							</li>
						))}
					</ul>
					<div className="flex justify-between border-border border-t pt-2 text-sm">
						<span className="text-muted-foreground">{m.cart_subtotal()}</span>
						<span className="font-medium tabular-nums">
							{formatPriceEur(group.subtotal)}
						</span>
					</div>
				</section>
			))}

			<div className="space-y-3">
				{payNow > 0 && (
					<div className="flex items-baseline justify-between">
						<span className="font-medium text-foreground">
							{m.checkout_pay_now()}
						</span>
						<span className="font-semibold text-foreground text-xl tabular-nums">
							{formatPriceEur(payNow / 100)}
						</span>
					</div>
				)}
				{payInStore > 0 && (
					<div className="flex items-baseline justify-between">
						<span className="font-medium text-foreground">
							{m.checkout_pay_in_store()}
						</span>
						<span className="font-semibold text-foreground text-xl tabular-nums">
							{formatPriceEur(payInStore / 100)}
						</span>
					</div>
				)}
				{payInStore > 0 && (
					<p className="rounded-lg bg-muted p-3 text-foreground text-sm">
						{m.checkout_reserve_note({ hours: RESERVATION_HOURS })}
					</p>
				)}
			</div>

			<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
				<Button asChild variant="secondary" className="min-h-11">
					<Link to="/checkout" search={{ choice: serializeChoice(choice) }}>
						{m.checkout_choose_title()}
					</Link>
				</Button>
				<Button
					size="lg"
					className="min-h-11"
					onClick={confirm}
					disabled={createCheckout.isPending || createCheckout.isSuccess}
				>
					{confirmLabel(types)}
				</Button>
			</div>
		</div>
	);
}
