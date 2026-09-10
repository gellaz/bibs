import { Button } from "@bibs/ui/components/button";
import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ShoppingBag, TriangleAlert } from "lucide-react";
import { NoticePage } from "@/components/notice";
import { TileImage } from "@/components/tile";
import { AddToCart } from "@/features/cart/add-to-cart";
import type { CartGroup, CartLine } from "@/features/cart/use-cart";
import { useCart } from "@/features/cart/use-cart";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/cart")({
	component: CartPage,
});

function CartPage() {
	const { cart, isPending, isError, refetch } = useCart();

	if (isPending)
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-28 w-full" />
				<Skeleton className="h-28 w-full" />
			</div>
		);

	if (isError)
		return (
			<NoticePage
				icon={TriangleAlert}
				title={m.cart_error_title()}
				description={m.cart_error_description()}
				action={
					<Button variant="secondary" onClick={() => refetch()}>
						{m.cart_retry()}
					</Button>
				}
			/>
		);

	if (!cart || cart.groups.length === 0)
		return (
			<NoticePage
				icon={ShoppingBag}
				title={m.cart_empty_title()}
				description={m.cart_empty_description()}
				action={
					<Button asChild>
						<Link to="/stores" search={{ q: undefined, categoryId: undefined }}>
							{m.cart_empty_cta()}
						</Link>
					</Button>
				}
			/>
		);

	return (
		<div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6">
			<h1 className="font-display font-semibold text-2xl text-foreground">
				{m.cart_title()}
			</h1>

			{cart.groups.map((group) => (
				<StoreSection key={group.store.id} group={group} />
			))}

			{/* Nessun CTA di checkout: non esiste ancora una pagina dove mandarlo, e
			    un bottone disabilitato sarebbe un controllo morto. */}
			<div className="flex items-baseline justify-between border-border border-t pt-4">
				<span className="font-medium text-foreground">{m.cart_total()}</span>
				<span className="font-display font-semibold text-foreground text-xl tabular-nums">
					{formatPriceEur(cart.total)}
				</span>
			</div>
		</div>
	);
}

/** Un negozio e le sue righe. L'identità del negozio apre la sezione: è la
 *  regola del prodotto, non un dettaglio grafico. */
function StoreSection({ group }: { group: CartGroup }) {
	return (
		<section className="space-y-3">
			<div className="flex items-baseline justify-between gap-3">
				<h2>
					<Link
						to="/stores/$storeId"
						params={{ storeId: group.store.id }}
						className="font-display font-semibold text-foreground text-lg hover:underline"
					>
						{group.store.name}
					</Link>
				</h2>
				<span className="text-muted-foreground text-sm">
					{group.store.municipality.name} (
					{group.store.municipality.provinceAcronym})
				</span>
			</div>

			<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
				{group.items.map((item) => (
					<li key={item.id}>
						<CartRow item={item} />
					</li>
				))}
			</ul>

			<div className="flex items-baseline justify-between px-1">
				<span className="text-muted-foreground text-sm">
					{m.cart_subtotal()}
				</span>
				<span className="font-medium text-foreground tabular-nums">
					{formatPriceEur(group.subtotal)}
				</span>
			</div>
		</section>
	);
}

function CartRow({ item }: { item: CartLine }) {
	const { removeItem } = useCart();
	const unavailable = item.issue === "unavailable";
	const outOfStock = item.availableStock === 0;
	// Lo stepper ha senso solo se resta qualcosa da comprare.
	const showStepper = !unavailable && !outOfStock;
	// Qualsiasi riga con un problema deve poter uscire dal carrello. Senza
	// questo, una riga esaurita non ha NESSUN controllo attivo e ci resta per
	// sempre.
	const showRemove = item.issue !== "ok";

	return (
		<div className="flex gap-3 p-3">
			<div className="size-20 shrink-0 overflow-hidden rounded-lg border border-border">
				<TileImage url={item.product.imageUrl} name={item.product.name} />
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<h3 className="line-clamp-2 font-medium text-foreground text-sm leading-snug">
					{item.product.name}
				</h3>

				<DiscountedPrice
					size="sm"
					className="tabular-nums"
					originalPrice={item.unitPrice}
					discountedPrice={item.discountedPrice}
					percent={item.discountPercent}
				/>

				{item.issue === "insufficient_stock" && (
					<p className="text-destructive text-xs">
						{outOfStock
							? m.cart_out_of_stock()
							: m.cart_only_left({ count: item.availableStock })}
					</p>
				)}
				{unavailable && (
					<p className="text-muted-foreground text-xs">
						{m.cart_unavailable_description()}
					</p>
				)}

				{/* flex-wrap + shrink-0 sul prezzo: quando stepper e Rimuovi
				    convivono (stock sceso sotto la quantità) a 390px lo spazio non
				    basta, e senza questi due il totale di riga veniva TAGLIATO —
				    perdeva il simbolo € — invece di andare a capo, perché la lista
				    ha overflow-hidden e ritaglia in silenzio. */}
				<div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-1">
					<div className="flex items-center gap-2">
						{showStepper && (
							<div className="w-32">
								<AddToCart
									storeProductId={item.storeProductId}
									stock={item.availableStock}
									productName={item.product.name}
								/>
							</div>
						)}
						{showRemove && (
							<Button
								variant="secondary"
								size="sm"
								onClick={() => removeItem.mutate(item.id)}
								disabled={removeItem.isPending}
							>
								{m.cart_remove()}
							</Button>
						)}
					</div>
					<span
						className={`ml-auto shrink-0 font-medium tabular-nums ${unavailable ? "text-muted-foreground line-through" : "text-foreground"}`}
					>
						{formatPriceEur(item.lineTotal)}
					</span>
				</div>
			</div>
		</div>
	);
}
