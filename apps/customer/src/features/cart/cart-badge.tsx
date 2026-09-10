import { Link } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { m } from "@/paraglide/messages";
import { useCart } from "./use-cart";

/**
 * Contatore nella top app bar. Legge `itemCount` dalla stessa query `["cart"]`
 * che alimenta pagina e stepper: nessun endpoint né fetch dedicato.
 *
 * Borsa e non carrello della spesa: il registro del brand è la bottega, non il
 * supermercato (vedi le anti-reference in PRODUCT.md).
 */
export function CartBadge() {
	const { cart } = useCart();
	const count = cart?.itemCount ?? 0;

	return (
		<Link
			to="/cart"
			aria-label={m.cart_badge_aria({ count })}
			className="relative rounded-md p-2 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-saffron focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[status=active]:text-foreground"
		>
			<ShoppingBag className="size-5" aria-hidden />
			{count > 0 && (
				<span className="-top-0.5 -right-0.5 absolute flex min-w-4.5 items-center justify-center rounded-full bg-saffron px-1 font-semibold text-[0.6875rem] text-ink tabular-nums">
					{count}
				</span>
			)}
		</Link>
	);
}
