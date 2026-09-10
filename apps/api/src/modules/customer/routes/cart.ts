import { Elysia, t } from "elysia";
import { MAX_CART_ITEM_QUANTITY } from "@/db/schemas/cart";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	CartItemMutationSchema,
	CartSchema,
	OkMessage,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withCustomer } from "../context";
import {
	addCartItem,
	getCart,
	removeCartItem,
	setCartItemQuantity,
} from "../services/cart";

export const cartRoutes = new Elysia()
	.get(
		"/cart",
		async (ctx) => {
			const { customerProfile: cp } = withCustomer(ctx);
			return ok(await getCart(cp.id));
		},
		{
			response: withErrors({ 200: okRes(CartSchema) }),
			detail: {
				summary: "Carrello",
				description:
					"Restituisce il carrello del cliente, raggruppato per negozio. Prezzi e sconti sono letti al momento della richiesta. Le righe non più acquistabili vengono annotate, non rimosse.",
				tags: ["Customer - Cart"],
			},
		},
	)
	.post(
		"/cart/items",
		async (ctx) => {
			const { customerProfile: cp, body, store, user } = withCustomer(ctx);
			const pino = getLogger(store);

			const data = await addCartItem({
				customerProfileId: cp.id,
				...body,
			});

			pino.info(
				{
					userId: user.id,
					customerProfileId: cp.id,
					cartItemId: data.id,
					storeProductId: body.storeProductId,
					quantity: data.quantity,
					action: "cart_item_added",
				},
				"Prodotto aggiunto al carrello",
			);

			return ok(data);
		},
		{
			body: t.Object({
				storeProductId: t.String({
					description: "ID della riga store_products da aggiungere",
				}),
				quantity: t.Integer({
					minimum: 1,
					maximum: MAX_CART_ITEM_QUANTITY,
					description: "Quantità da aggiungere a quella già presente",
				}),
			}),
			response: withConflictErrors({ 200: okRes(CartItemMutationSchema) }),
			detail: {
				summary: "Aggiungi al carrello",
				description:
					"Aggiunge un prodotto al carrello. Se il prodotto è già presente, la quantità viene sommata. Rifiuta se il negozio non è pubblicamente visibile, se il prodotto non è attivo, o se si supera la disponibilità.",
				tags: ["Customer - Cart"],
			},
		},
	)
	.patch(
		"/cart/items/:id",
		async (ctx) => {
			const { customerProfile: cp, params, body } = withCustomer(ctx);
			const data = await setCartItemQuantity({
				cartItemId: params.id,
				customerProfileId: cp.id,
				...body,
			});
			return ok(data);
		},
		{
			params: t.Object({
				id: t.String({ description: "ID della riga di carrello" }),
			}),
			body: t.Object({
				quantity: t.Integer({
					minimum: 1,
					maximum: MAX_CART_ITEM_QUANTITY,
					description: "Nuova quantità (valore assoluto)",
				}),
			}),
			response: withErrors({ 200: okRes(CartItemMutationSchema) }),
			detail: {
				summary: "Aggiorna quantità",
				description:
					"Imposta la quantità di una riga del carrello. Per rimuoverla usa DELETE: la quantità minima è 1.",
				tags: ["Customer - Cart"],
			},
		},
	)
	.delete(
		"/cart/items/:id",
		async (ctx) => {
			const { customerProfile: cp, params } = withCustomer(ctx);
			await removeCartItem({
				cartItemId: params.id,
				customerProfileId: cp.id,
			});
			return okMessage("Prodotto rimosso dal carrello");
		},
		{
			params: t.Object({
				id: t.String({ description: "ID della riga di carrello" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi dal carrello",
				description: "Rimuove una riga dal carrello del cliente.",
				tags: ["Customer - Cart"],
			},
		},
	);
