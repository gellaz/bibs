import { Hono } from "hono";
import { z } from "zod";
import { orderTypes } from "@/db/schemas/order";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok, okPage } from "@/lib/responses";
import { SellerOrderWithRelationsSchema } from "@/lib/zod/composed";
import { OrderSchema } from "@/lib/zod/entities";
import { OrderListQuery } from "@/lib/zod/queries";
import {
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/zod/responses";
import { zInteger } from "@/lib/zod/t";
import { ensureStoreAccess } from "../context";
import {
	cancelSellerOrder,
	completePickupByCode,
	countSellerOrdersByStatus,
	findOpenOrderByPickupCode,
	getSellerOrder,
	listSellerOrders,
	transitionOrder,
} from "../services/orders";

const security = [{ bearerAuth: [] }];
const tags = ["Seller - Orders"];

const OrderParams = z.object({
	orderId: z.string().meta({ description: "ID dell'ordine" }),
});
const pickupCode = z.string().max(20).meta({ description: "Codice di ritiro" });

const OrdersPageRes = okPageRes(SellerOrderWithRelationsSchema);
const SellerOrderRes = okRes(SellerOrderWithRelationsSchema);
const OrderRes = okRes(OrderSchema);
const CountsRes = okRes(
	z.record(z.string(), zInteger({ minimum: 0 })).meta({
		description: "Numero di ordini per stato (tutti gli stati, zeri inclusi)",
	}),
);

export const ordersRoutes = new Hono()
	.get(
		"/orders",
		doc({
			response: withErrors({ 200: OrdersPageRes }),
			detail: {
				summary: "Lista ordini venditore (negozio attivo)",
				description:
					"Restituisce gli ordini del negozio specificato, filtrati e paginati.",
				tags,
				security,
			},
		}),
		v(
			"query",
			OrderListQuery.extend({
				storeId: z.string().meta({ description: "ID del negozio attivo" }),
			}),
		),
		requireSeller,
		async (c) => {
			const query = c.req.valid("query");
			await ensureStoreAccess(query.storeId, c.var.seller.accessCtx);
			const result = await listSellerOrders({
				storeIds: [query.storeId],
				...query,
			});
			return send(c, OrdersPageRes, okPage(result.data, result.pagination));
		},
	)
	.get(
		"/orders/counts",
		doc({
			response: withErrors({ 200: CountsRes }),
			detail: {
				summary: "Conteggi ordini per stato",
				description:
					"Conta gli ordini del negozio per stato, per le tab della lista ordini.",
				tags,
				security,
			},
		}),
		v(
			"query",
			z.object({
				storeId: z.string().meta({ description: "ID del negozio" }),
				type: z
					.enum(orderTypes)
					.meta({ description: "Filtra per tipologia" })
					.optional(),
			}),
		),
		requireSeller,
		async (c) => {
			const query = c.req.valid("query");
			await ensureStoreAccess(query.storeId, c.var.seller.accessCtx);
			const data = await countSellerOrdersByStatus(query);
			return send(c, CountsRes, ok(data));
		},
	)
	.get(
		"/orders/pickup/:code",
		doc({
			response: withErrors({ 200: SellerOrderRes }),
			detail: {
				summary: "Anteprima ritiro per codice",
				description:
					"L'ordine aperto del negozio con quel codice di ritiro, da mostrare al banco prima di confermare.",
				tags,
				security,
			},
		}),
		v("param", z.object({ code: pickupCode })),
		v(
			"query",
			z.object({ storeId: z.string().meta({ description: "Negozio attivo" }) }),
		),
		requireSeller,
		async (c) => {
			const { storeId } = c.req.valid("query");
			await ensureStoreAccess(storeId, c.var.seller.accessCtx);
			const data = await findOpenOrderByPickupCode({
				storeId,
				code: c.req.valid("param").code,
			});
			return send(c, SellerOrderRes, ok(data));
		},
	)
	.post(
		"/orders/pickup",
		doc({
			response: withConflictErrors({ 200: OrderRes }),
			detail: {
				summary: "Conferma ritiro per codice",
				description:
					"Completa l'ordine aperto con quel codice nel negozio e accredita i punti. Una prenotazione scaduta viene fatta scadere con rimborso (400).",
				tags,
				security,
			},
		}),
		v(
			"json",
			z.object({
				storeId: z.string().meta({ description: "Negozio attivo" }),
				code: pickupCode,
			}),
		),
		requireSeller,
		async (c) => {
			const { accessCtx, sellerProfile: sp } = c.var.seller;
			const body = c.req.valid("json");
			await ensureStoreAccess(body.storeId, accessCtx);
			const data = await completePickupByCode({
				storeId: body.storeId,
				code: body.code,
				sellerProfileId: sp.id,
			});
			logger.info(
				{
					userId: c.var.user.id,
					orderId: data.id,
					action: "order_picked_up_by_code",
				},
				"Ritiro confermato al banco",
			);
			return send(c, OrderRes, ok(data));
		},
	)
	.get(
		"/orders/:orderId",
		doc({
			response: withErrors({ 200: SellerOrderRes }),
			detail: {
				summary: "Dettaglio ordine venditore",
				description:
					"Restituisce il dettaglio completo di un ordine ricevuto, inclusi articoli, cliente, negozio e indirizzo di spedizione.",
				tags,
				security,
			},
		}),
		v("param", OrderParams),
		requireSeller,
		async (c) => {
			const data = await getSellerOrder({
				orderId: c.req.valid("param").orderId,
				storeIds: await c.var.seller.getAccessibleStoreIds(),
			});
			return send(c, SellerOrderRes, ok(data));
		},
	)
	.patch(
		"/orders/:orderId/ready",
		doc({
			response: withConflictErrors({ 200: OrderRes }),
			detail: {
				summary: "Segna ordine come pronto",
				description:
					"Transizione dell'ordine a 'ready_for_pickup'. Valido solo per ordini confermati di tipo pay_pickup, pay_deliver o reserve_pickup.",
				tags,
				security,
			},
		}),
		v("param", OrderParams),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, getAccessibleStoreIds } = c.var.seller;
			const data = await transitionOrder(
				c.req.valid("param").orderId,
				sp.id,
				"ready_for_pickup",
				await getAccessibleStoreIds(),
			);
			return send(c, OrderRes, ok(data));
		},
	)
	.patch(
		"/orders/:orderId/ship",
		doc({
			response: withConflictErrors({ 200: OrderRes }),
			detail: {
				summary: "Spedisci ordine",
				description:
					"Transizione a 'shipped'. Valido solo per ordini pay_deliver in stato ready_for_pickup.",
				tags,
				security,
			},
		}),
		v("param", OrderParams),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, getAccessibleStoreIds } = c.var.seller;
			const data = await transitionOrder(
				c.req.valid("param").orderId,
				sp.id,
				"shipped",
				await getAccessibleStoreIds(),
			);
			return send(c, OrderRes, ok(data));
		},
	)
	.patch(
		"/orders/:orderId/complete",
		doc({
			response: withConflictErrors({ 200: OrderRes }),
			detail: {
				summary: "Completa ordine",
				description:
					"Transizione a 'completed'. Le transizioni valide dipendono dal tipo e dallo stato corrente dell'ordine.",
				tags,
				security,
			},
		}),
		v("param", OrderParams),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, getAccessibleStoreIds } = c.var.seller;
			const data = await transitionOrder(
				c.req.valid("param").orderId,
				sp.id,
				"completed",
				await getAccessibleStoreIds(),
			);
			return send(c, OrderRes, ok(data));
		},
	)
	.patch(
		"/orders/:orderId/cancel",
		doc({
			response: withConflictErrors({ 200: OrderRes }),
			detail: {
				summary: "Annulla ordine",
				description:
					"Annulla un ordine. Lo stock torna disponibile e i punti spesi vengono restituiti; un ordine pagato online viene rimborsato. 409 se è in attesa di pagamento.",
				tags,
				security,
			},
		}),
		v("param", OrderParams),
		requireSeller,
		async (c) => {
			const data = await cancelSellerOrder({
				orderId: c.req.valid("param").orderId,
				storeIds: await c.var.seller.getAccessibleStoreIds(),
			});
			logger.warn(
				{
					userId: c.var.user.id,
					orderId: data.id,
					orderType: data.type,
					action: "order_cancelled_by_seller",
				},
				"Ordine annullato dal negozio",
			);
			return send(c, OrderRes, ok(data));
		},
	);
