import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { toast } from "@bibs/ui/components/sonner";
import { Switch } from "@bibs/ui/components/switch";
import { formatPriceEur } from "@bibs/ui/custom/price";
import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Navigate,
	useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TileImage } from "@/components/tile";
import { CART_KEY, useCart } from "@/features/cart/use-cart";
import { buyableGroups } from "@/features/checkout/buyable";
import {
	type CheckoutChoice,
	checkoutFailure,
	confirmLabel,
	parseChoice,
	resolveChoice,
	serializeChoice,
} from "@/features/checkout/checkout-choice";
import {
	amountDueOnline,
	formatPoints,
	onlineChargeBlocked,
	pointsToggleLabel,
} from "@/features/checkout/points-toggle";
import { checkoutTypeLabel } from "@/features/checkout/store-choice";
import {
	CheckoutError,
	useCheckoutPreview,
	useCreateCheckout,
} from "@/features/checkout/use-checkout";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/checkout/review")({
	component: CheckoutReviewPage,
	validateSearch: (search: Record<string, unknown>) => ({
		choice: typeof search.choice === "string" ? search.choice : undefined,
	}),
});

const RESERVATION_HOURS = 48;
const toCents = (v: string) => Math.round(Number(v) * 100);

type Preview = NonNullable<ReturnType<typeof useCheckoutPreview>["data"]>;

function CheckoutReviewPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { cart, isPending } = useCart();
	const createCheckout = useCreateCheckout();
	// Stabile per tutta la vita della pagina: un doppio click o un retry di rete
	// riusano la stessa key e l'API restituisce lo stesso checkout.
	const [idempotencyKey] = useState(() => crypto.randomUUID());
	// Quel che si è confermato, congelato al click: se la risposta si perde e il
	// carrello (già svuotato dal server) viene riletto, la pagina resta quella
	// da cui riprovare.
	// Anche importi e interruttore: dopo l'invio la preview non si rilegge, e un
	// retry idempotente deve rimandare la stessa scelta sui punti.
	const [submitted, setSubmitted] = useState<{
		groups: ReturnType<typeof buyableGroups>;
		choice: CheckoutChoice;
		usePoints: boolean;
		preview: Preview;
	} | null>(null);
	// Spento di default; vive solo nella pagina.
	const [usePoints, setUsePoints] = useState(false);

	const live = buyableGroups(cart);
	const resolved = resolveChoice(live, parseChoice(search.choice));
	const preview = useCheckoutPreview(
		resolved.choice,
		!submitted && resolved.complete,
	);

	// 409/400: il carrello o la scelta non reggono più, come alla conferma.
	const previewError = preview.error;
	useEffect(() => {
		if (
			previewError instanceof CheckoutError &&
			checkoutFailure(previewError.status) === "back_to_cart"
		) {
			toast.error(previewError.message || m.checkout_cart_changed());
			void queryClient.invalidateQueries({ queryKey: CART_KEY });
			void navigate({ to: "/cart" });
		}
	}, [previewError, navigate, queryClient]);

	if (isPending)
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-56 w-full" />
			</div>
		);

	const groups = submitted?.groups ?? live;
	const choice = submitted?.choice ?? resolved.choice;
	// Dopo la conferma il carrello si svuota: non rimbalzare sulla scelta.
	if (!submitted && !resolved.complete)
		return (
			<Navigate
				to="/checkout"
				search={{ choice: serializeChoice(choice) }}
				replace
			/>
		);

	const types = groups.map((g) => choice[g.store.id]);
	const data = submitted?.preview ?? preview.data;
	const points = submitted?.usePoints ?? usePoints;
	const withPoints = data?.withPoints ?? null;
	const pointsOn = points && withPoints !== null;
	// Importi dall'API: lordo online, netto con i punti, quota in negozio.
	const payNow = data ? toCents(data.withoutPoints.amountDueOnline) : 0;
	const payByCard = data ? toCents(amountDueOnline(data, points)) : 0;
	const payInStore = data ? toCents(data.payInStore) : 0;
	// Sotto il minimo Stripe la conferma fallirebbe: avviso e bottone spento.
	const blocked = data ? onlineChargeBlocked(data, points) : false;
	// La riga per negozio serve solo quando i punti si dividono tra più PR2.
	const showStoreDiscount =
		pointsOn && types.filter((t) => t === "pay_pickup").length > 1;
	const storeDiscount = (storeId: string) =>
		withPoints?.perStore.find(
			(p) => p.storeId === storeId && p.pointsSpent > 0,
		);

	const confirm = () => {
		if (!data) return;
		if (blocked) return;
		// Mai `true` con l'interruttore nascosto (preview riletta senza punti).
		setSubmitted({ groups, choice, usePoints: pointsOn, preview: data });
		createCheckout.mutate(
			{
				idempotencyKey,
				stores: groups.map((g) => ({
					storeId: g.store.id,
					type: choice[g.store.id],
				})),
				usePoints: pointsOn,
			},
			{
				onSuccess: (data) =>
					void navigate({
						to: data.payment
							? "/checkout/$checkoutId/pay"
							: "/checkout/$checkoutId",
						params: { checkoutId: data.id },
						replace: true,
					}),
				onError: (e) => {
					const status = e instanceof CheckoutError ? e.status : undefined;
					if (checkoutFailure(status) === "back_to_cart") {
						toast.error(e.message || m.checkout_cart_changed());
						void navigate({ to: "/cart" });
					} else {
						// Resta qui con la stessa chiave: ripremere restituisce lo
						// stesso checkout se il server l'aveva già creato.
						toast.error(m.checkout_retry());
					}
				},
			},
		);
	};

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
					{showStoreDiscount &&
						(() => {
							const d = storeDiscount(group.store.id);
							return d ? (
								<div className="flex justify-between text-sm">
									<span className="text-muted-foreground">
										{m.checkout_points_store_discount()}
									</span>
									<span className="font-medium tabular-nums">
										−{formatPriceEur(d.discount)}
									</span>
								</div>
							) : null;
						})()}
				</section>
			))}

			{!data ? (
				preview.isError ? (
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3">
						<p className="text-foreground text-sm">
							{m.checkout_preview_failed()}
						</p>
						<Button
							variant="secondary"
							className="min-h-11"
							onClick={() => void preview.refetch()}
						>
							{m.cart_retry()}
						</Button>
					</div>
				) : (
					<Skeleton className="h-20 w-full" />
				)
			) : (
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
					{withPoints && (
						<label
							htmlFor="checkout-use-points"
							className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3"
						>
							<span className="space-y-0.5">
								<span className="block font-medium text-foreground text-sm">
									{pointsToggleLabel(withPoints, data.balance)}
								</span>
								<span className="block text-muted-foreground text-xs">
									{m.checkout_points_balance({
										balance: formatPoints(data.balance),
									})}
								</span>
							</span>
							<span className="flex items-center gap-3">
								<span className="font-medium tabular-nums">
									−{formatPriceEur(withPoints.discount)}
								</span>
								<Switch
									id="checkout-use-points"
									checked={points}
									onCheckedChange={setUsePoints}
									disabled={!!submitted}
								/>
							</span>
						</label>
					)}
					{pointsOn && (
						<div className="flex items-baseline justify-between">
							<span className="font-medium text-foreground">
								{m.checkout_pay_by_card()}
							</span>
							<span className="font-semibold text-foreground text-xl tabular-nums">
								{formatPriceEur(payByCard / 100)}
							</span>
						</div>
					)}
					{blocked && (
						<div
							role="status"
							className="space-y-1 rounded-lg bg-muted p-3 text-foreground text-sm"
						>
							<p>
								{m.checkout_min_charge_note({
									min: formatPriceEur(data.minAmountOnline),
								})}
							</p>
							{withPoints && <p>{m.checkout_min_charge_points()}</p>}
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
			)}

			<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
				<Button asChild variant="secondary" className="min-h-11">
					<Link to="/checkout" search={{ choice: serializeChoice(choice) }}>
						{m.checkout_edit_choice()}
					</Link>
				</Button>
				<Button
					size="lg"
					className="min-h-11"
					onClick={confirm}
					disabled={
						!data ||
						blocked ||
						createCheckout.isPending ||
						createCheckout.isSuccess
					}
				>
					{confirmLabel(types, data ? payByCard : undefined)}
				</Button>
			</div>
		</div>
	);
}
