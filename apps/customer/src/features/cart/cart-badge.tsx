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
export function CartBadge({ className }: { className?: string }) {
	const { cart } = useCart();
	const count = cart?.itemCount ?? 0;

	return (
		<Link
			to="/cart"
			aria-label={m.cart_badge_aria({ count })}
			className={`relative flex items-center rounded-md p-2 text-muted-foreground outline-none max-sm:p-3 transition-colors hover:text-foreground focus-visible:focus-ring ${className ?? ""}`}
		>
			{/* Il contatore si ancora all'icona, non al link: da `sm` il link è alto
			    quanto la barra. */}
			<span className="relative">
				<ShoppingBag className="size-5" aria-hidden />
				{count > 0 && (
					<span className="-top-2.5 -right-2.5 absolute flex min-w-4.5 items-center justify-center rounded-full bg-saffron px-1 font-semibold text-[0.6875rem] text-ink tabular-nums">
						{count}
					</span>
				)}
			</span>
		</Link>
	);
}
