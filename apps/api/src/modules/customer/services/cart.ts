import { and, eq } from "drizzle-orm";
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

		const [existing] = await tx
			.select({ id: cartItem.id, quantity: cartItem.quantity })
			.from(cartItem)
			.where(
				and(
					eq(cartItem.customerProfileId, customerProfileId),
					eq(cartItem.storeProductId, storeProductId),
				),
			)
			.limit(1);

		const nextQuantity = (existing?.quantity ?? 0) + quantity;

		if (nextQuantity > MAX_CART_ITEM_QUANTITY)
			throw new ServiceError(
				400,
				`Puoi aggiungere al massimo ${MAX_CART_ITEM_QUANTITY} pezzi per prodotto`,
			);

		if (nextQuantity > sellable.stock)
			throw new ServiceError(
				400,
				sellable.stock === 0
					? "Questo prodotto è esaurito"
					: `Ne restano solo ${sellable.stock}`,
			);

		if (existing) {
			const [updated] = await tx
				.update(cartItem)
				.set({ quantity: nextQuantity })
				.where(eq(cartItem.id, existing.id))
				.returning({ id: cartItem.id, quantity: cartItem.quantity });
			return updated;
		}

		const [created] = await tx
			.insert(cartItem)
			.values({ customerProfileId, storeProductId, quantity: nextQuantity })
			.returning({ id: cartItem.id, quantity: cartItem.quantity });
		return created;
	});
}
