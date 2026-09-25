import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cartItem } from "@/db/schemas/cart";
import { checkout } from "@/db/schemas/checkout";
import { product, storeProduct } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { isUniqueViolation, ServiceError } from "@/lib/errors";
import { offeredOrderTypes } from "@/lib/order-types";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import { listCustomerOrders, placeOrder } from "./orders";

export interface CreateCheckoutParams {
	customerProfileId: string;
	customerPoints: number;
	idempotencyKey: string;
	stores: { storeId: string; type: "reserve_pickup" | "pay_pickup" }[];
}

/** Un checkout con i suoi ordini, nella stessa forma della lista ordini. */
export async function getCheckout(params: {
	checkoutId: string;
	customerProfileId: string;
}) {
	const found = await db.query.checkout.findFirst({
		where: and(
			eq(checkout.id, params.checkoutId),
			eq(checkout.customerProfileId, params.customerProfileId),
		),
	});
	if (!found) throw new ServiceError(404, "Checkout non trovato");
	const { data } = await listCustomerOrders({
		customerProfileId: params.customerProfileId,
		checkoutId: found.id,
		page: 1,
		limit: 100,
	});
	return { id: found.id, createdAt: found.createdAt, orders: data };
}

/**
 * Trasforma il carrello in un ordine per negozio, in UNA transazione: o nascono
 * tutti o nessuno, e nella stessa tx escono dal carrello le righe ordinate.
 * Le righe si leggono dal carrello lato server: il client sceglie solo negozi e
 * tipologia. Righe non disponibili: saltate, restano nel carrello. Stock
 * insufficiente: 409, il cliente torna al carrello.
 */
export async function createCheckout(params: CreateCheckoutParams) {
	const { customerProfileId, customerPoints, idempotencyKey, stores } = params;

	const existing = await db.query.checkout.findFirst({
		where: eq(checkout.idempotencyKey, idempotencyKey),
	});
	if (existing) {
		if (existing.customerProfileId !== customerProfileId)
			throw new ServiceError(409, "Chiave di idempotenza già usata");
		return getCheckout({ checkoutId: existing.id, customerProfileId });
	}

	const storeIds = stores.map((s) => s.storeId);
	if (new Set(storeIds).size !== storeIds.length)
		throw new ServiceError(400, "Ogni negozio può comparire una sola volta");

	const created = db
		.transaction(async (tx) => {
			const [row] = await tx
				.insert(checkout)
				.values({ customerProfileId, idempotencyKey })
				.returning({ id: checkout.id });

			// Righe del carrello per i negozi scelti, con quanto serve a decidere
			// se sono acquistabili (stessa definizione di getCart).
			const lines = await tx
				.select({
					id: cartItem.id,
					storeProductId: cartItem.storeProductId,
					quantity: cartItem.quantity,
					stock: storeProduct.stock,
					productStatus: product.status,
					storeId: store.id,
					storeName: store.name,
					orderTypes: store.orderTypes,
				})
				.from(cartItem)
				.innerJoin(storeProduct, eq(storeProduct.id, cartItem.storeProductId))
				.innerJoin(product, eq(product.id, storeProduct.productId))
				.innerJoin(store, eq(store.id, storeProduct.storeId))
				.where(
					and(
						eq(cartItem.customerProfileId, customerProfileId),
						inArray(store.id, storeIds),
						publiclyVisibleStore(),
					),
				)
				// Due checkout dello stesso cliente (due schede, chiavi diverse) non
				// devono leggere le stesse righe: il secondo aspetta il primo e poi
				// non le trova più → 409, invece di un ordine doppio.
				.for("update", { of: cartItem });

			for (const choice of stores) {
				const own = lines.filter((l) => l.storeId === choice.storeId);
				const buyable = own.filter((l) => l.productStatus === "active");
				if (buyable.length === 0)
					throw new ServiceError(
						409,
						"Il carrello è cambiato: questo negozio non ha più articoli acquistabili",
					);
				if (!offeredOrderTypes(own[0].orderTypes).includes(choice.type))
					throw new ServiceError(
						400,
						`${own[0].storeName} non offre questa modalità d'acquisto`,
					);
				if (buyable.some((l) => l.stock < l.quantity))
					throw new ServiceError(
						409,
						"Il carrello è cambiato: alcune quantità non sono più disponibili",
					);

				await placeOrder(
					tx,
					{
						customerProfileId,
						customerPoints,
						type: choice.type,
						storeId: choice.storeId,
						items: buyable.map((l) => ({
							storeProductId: l.storeProductId,
							quantity: l.quantity,
						})),
					},
					{ checkoutId: row.id },
				);

				const removed = await tx
					.delete(cartItem)
					.where(
						and(
							eq(cartItem.customerProfileId, customerProfileId),
							inArray(
								cartItem.id,
								buyable.map((l) => l.id),
							),
						),
					)
					.returning({ id: cartItem.id });
				// Rete di sicurezza del lock qui sopra: se le righe ordinate non sono
				// più tutte lì, qualcun altro le ha già consumate.
				if (removed.length !== buyable.length)
					throw new ServiceError(
						409,
						"Il carrello è cambiato: alcune quantità non sono più disponibili",
					);
			}

			return row.id;
		})
		.catch(async (err: unknown) => {
			// Race sulla key: un'altra richiesta identica ha vinto l'insert.
			if (isUniqueViolation(err)) {
				const winner = await db.query.checkout.findFirst({
					where: eq(checkout.idempotencyKey, idempotencyKey),
				});
				if (winner?.customerProfileId === customerProfileId) return winner.id;
			}
			throw err;
		});

	return getCheckout({ checkoutId: await created, customerProfileId });
}
