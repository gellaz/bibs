import type { CartData } from "@/features/cart/use-cart";

/** Gruppi del carrello che il checkout può ordinare, con le sole righe
 *  acquistabili: le `unavailable` restano nel carrello, come fa l'API. */
export function buyableGroups(cart: CartData | undefined) {
	return (cart?.groups ?? [])
		.map((g) => ({
			...g,
			items: g.items.filter((i) => i.issue !== "unavailable"),
		}))
		.filter((g) => g.items.length > 0);
}
