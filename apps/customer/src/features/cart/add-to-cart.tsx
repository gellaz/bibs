import { Button } from "@bibs/ui/components/button";
import { Minus, Plus, Trash2 } from "lucide-react";
import { m } from "@/paraglide/messages";
import { useCart } from "./use-cart";

/** Stesso tetto per riga del DB (cart_item_quantity_range). */
const MAX_QUANTITY = 99;

interface AddToCartProps {
	storeProductId: string;
	stock: number;
	/** Serve solo alle etichette accessibili: i controlli sono icone. */
	productName: string;
}

/**
 * "Aggiungi" finché il prodotto non è nel carrello, poi stepper −/+.
 * La quantità mostrata viene sempre dalla query `["cart"]`: niente stato locale
 * da risincronizzare. A quantità 1 il "−" diventa un cestino, così togliere una
 * riga non richiede di andare in pagina carrello.
 */
export function AddToCart({
	storeProductId,
	stock,
	productName,
}: AddToCartProps) {
	const { linesByStoreProductId, addItem, setQuantity, removeItem } = useCart();
	const line = linesByStoreProductId.get(storeProductId);
	const busy =
		addItem.isPending || setQuantity.isPending || removeItem.isPending;

	if (stock === 0)
		return (
			<Button variant="secondary" size="sm" className="w-full" disabled>
				{m.cart_out_of_stock()}
			</Button>
		);

	if (!line)
		return (
			<Button
				size="sm"
				className="w-full"
				disabled={busy}
				aria-label={m.cart_add_aria({ product: productName })}
				onClick={() => addItem.mutate({ storeProductId, quantity: 1 })}
			>
				{m.cart_add()}
			</Button>
		);

	const atCeiling = line.quantity >= Math.min(stock, MAX_QUANTITY);
	const isLast = line.quantity === 1;

	return (
		<div className="flex items-center justify-between gap-1 rounded-md border border-border p-1">
			<Button
				variant="ghost"
				size="icon"
				className="size-8"
				disabled={busy}
				aria-label={
					isLast
						? m.cart_remove_aria({ product: productName })
						: m.cart_decrease_aria({ product: productName })
				}
				onClick={() =>
					isLast
						? removeItem.mutate(line.id)
						: setQuantity.mutate({
								cartItemId: line.id,
								quantity: line.quantity - 1,
							})
				}
			>
				{isLast ? (
					<Trash2 className="size-4" aria-hidden />
				) : (
					<Minus className="size-4" aria-hidden />
				)}
			</Button>
			<span className="min-w-6 text-center font-medium text-sm tabular-nums">
				{line.quantity}
			</span>
			<Button
				variant="ghost"
				size="icon"
				className="size-8"
				disabled={busy || atCeiling}
				aria-label={m.cart_increase_aria({ product: productName })}
				onClick={() =>
					setQuantity.mutate({
						cartItemId: line.id,
						quantity: line.quantity + 1,
					})
				}
			>
				<Plus className="size-4" aria-hidden />
			</Button>
		</div>
	);
}
