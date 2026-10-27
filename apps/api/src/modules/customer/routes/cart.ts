import { Hono } from "hono";
import { z } from "zod";
import { MAX_CART_ITEM_QUANTITY } from "@/db/schemas/cart";
import { requireCustomer } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { CartItemMutationSchema, CartSchema } from "@/schemas/entities";
import {
	OkMessage,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/schemas/responses";
import { zInteger } from "@/schemas/t";
import { customerSecurity } from "../context";
import {
	addCartItem,
	getCart,
	removeCartItem,
	setCartItemQuantity,
} from "../services/cart";

const CartResponse = okRes(CartSchema);
const MutationResponse = okRes(CartItemMutationSchema);
const ItemParams = z.object({
	id: z.string().meta({ description: "ID della riga di carrello" }),
});

export const cartRoutes = new Hono()
	.get(
		"/cart",
		doc({
			response: withErrors({ 200: CartResponse }),
			detail: {
				summary: "Carrello",
				description:
					"Restituisce il carrello del cliente, raggruppato per negozio. Prezzi e sconti sono letti al momento della richiesta. Le righe non più acquistabili vengono annotate, non rimosse.",
				tags: ["Customer - Cart"],
				...customerSecurity,
			},
		}),
		requireCustomer,
		async (c) =>
			send(c, CartResponse, ok(await getCart(c.var.customerProfile.id))),
	)
	.post(
		"/cart/items",
		doc({
			response: withConflictErrors({ 200: MutationResponse }),
			detail: {
				summary: "Aggiungi al carrello",
				description:
					"Aggiunge un prodotto al carrello. Se il prodotto è già presente, la quantità viene sommata. Rifiuta se il negozio non è pubblicamente visibile, se il prodotto non è attivo, o se si supera la disponibilità.",
				tags: ["Customer - Cart"],
				...customerSecurity,
			},
		}),
		v(
			"json",
			z.object({
				storeProductId: z.string().meta({
					description: "ID della riga store_products da aggiungere",
				}),
				quantity: zInteger({
					minimum: 1,
					maximum: MAX_CART_ITEM_QUANTITY,
					description: "Quantità da aggiungere a quella già presente",
				}),
			}),
		),
		requireCustomer,
		async (c) => {
			const cp = c.var.customerProfile;
			const body = c.req.valid("json");
			const data = await addCartItem({ customerProfileId: cp.id, ...body });

			logger.info(
				{
					userId: c.var.user.id,
					customerProfileId: cp.id,
					cartItemId: data.id,
					storeProductId: body.storeProductId,
					quantity: data.quantity,
					action: "cart_item_added",
				},
				"Prodotto aggiunto al carrello",
			);

			return send(c, MutationResponse, ok(data));
		},
	)
	.patch(
		"/cart/items/:id",
		doc({
			response: withErrors({ 200: MutationResponse }),
			detail: {
				summary: "Aggiorna quantità",
				description:
					"Imposta la quantità di una riga del carrello. Per rimuoverla usa DELETE: la quantità minima è 1.",
				tags: ["Customer - Cart"],
				...customerSecurity,
			},
		}),
		v("param", ItemParams),
		v(
			"json",
			z.object({
				quantity: zInteger({
					minimum: 1,
					maximum: MAX_CART_ITEM_QUANTITY,
					description: "Nuova quantità (valore assoluto)",
				}),
			}),
		),
		requireCustomer,
		async (c) => {
			const data = await setCartItemQuantity({
				cartItemId: c.req.valid("param").id,
				customerProfileId: c.var.customerProfile.id,
				...c.req.valid("json"),
			});
			return send(c, MutationResponse, ok(data));
		},
	)
	.delete(
		"/cart/items/:id",
		doc({
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi dal carrello",
				description: "Rimuove una riga dal carrello del cliente.",
				tags: ["Customer - Cart"],
				...customerSecurity,
			},
		}),
		v("param", ItemParams),
		requireCustomer,
		async (c) => {
			await removeCartItem({
				cartItemId: c.req.valid("param").id,
				customerProfileId: c.var.customerProfile.id,
			});
			return send(c, OkMessage, okMessage("Prodotto rimosso dal carrello"));
		},
	);
