import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cartItem, MAX_CART_ITEM_QUANTITY } from "@/db/schemas/cart";
import { product, storeProduct } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { publiclyVisibleStore } from "@/lib/store-visibility";

interface AddCartItemParams {
	customerProfileId: string;
	storeProductId: string;
	quantity: number;
}

/**
 * Aggiunge un prodotto al carrello, sommando se la riga esiste già.
 *
 * Il carrello NON riserva stock: lo decrementa `createOrder`, in transazione.
 * Qui lo stock è solo un tetto, così il cliente non accumula un'intenzione che
 * non potrà mai diventare un ordine.
 */
export async function addCartItem(
	params: AddCartItemParams,
): Promise<{ id: string; quantity: number }> {
	const { customerProfileId, storeProductId, quantity } = params;

	return db.transaction(async (tx) => {
		// publiclyVisibleStore() vive in una .where(): lì Drizzle qualifica le
		// Column correttamente (a differenza di un campo SELECT).
		const [sellable] = await tx
			.select({ stock: storeProduct.stock, status: product.status })
			.from(storeProduct)
			.innerJoin(product, eq(product.id, storeProduct.productId))
			.innerJoin(store, eq(store.id, storeProduct.storeId))
			.where(and(eq(storeProduct.id, storeProductId), publiclyVisibleStore()))
			.limit(1);

		// Un prodotto non acquistabile e un prodotto inesistente collassano nello
		// stesso 404: non si conferma l'esistenza di righe che non si possono
		// comprare.
		if (!sellable || sellable.status !== "active")
			throw new ServiceError(404, "Prodotto non disponibile");

		// Tetto effettivo: il minore fra il limite per riga e ciò che il negozio
		// ha davvero. Lo stock qui è un tetto, non una prenotazione — il
		// decremento resta in createOrder.
		const ceiling = Math.min(MAX_CART_ITEM_QUANTITY, sellable.stock);

		const limitError = () =>
			new ServiceError(
				400,
				sellable.stock < MAX_CART_ITEM_QUANTITY
					? sellable.stock === 0
						? "Questo prodotto è esaurito"
						: `Ne restano solo ${sellable.stock}`
					: `Puoi aggiungere al massimo ${MAX_CART_ITEM_QUANTITY} pezzi per prodotto`,
			);

		// La quantità richiesta da sola non può superare il tetto: copre la prima
		// aggiunta, dove non c'è conflitto e la setWhere qui sotto non si applica.
		if (quantity > ceiling) throw limitError();

		// Upsert atomico. L'incremento avviene DENTRO il database, quindi due
		// aggiunte simultanee si sommano invece di sovrascriversi — il
		// read-then-write che c'era prima perdeva l'aggiunta del perdente, in
		// silenzio. La setWhere fa sì che il superamento del tetto non aggiorni
		// nulla: RETURNING torna vuoto, ed è così che lo riconosciamo.
		const [row] = await tx
			.insert(cartItem)
			.values({ customerProfileId, storeProductId, quantity })
			.onConflictDoUpdate({
				target: [cartItem.customerProfileId, cartItem.storeProductId],
				set: {
					quantity: sql`${cartItem.quantity} + ${quantity}`,
					updatedAt: new Date(),
				},
				setWhere: sql`${cartItem.quantity} + ${quantity} <= ${ceiling}`,
			})
			.returning({ id: cartItem.id, quantity: cartItem.quantity });

		if (!row) throw limitError();

		return row;
	});
}
