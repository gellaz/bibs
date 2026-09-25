import { Elysia, t } from "elysia";
import { orderTypes } from "@/db/schemas/order";
import { getLogger } from "@/lib/logger";
import { OrderListQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	OrderSchema,
	okPageRes,
	okRes,
	SellerOrderWithRelationsSchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { ensureStoreAccess, withSeller } from "../context";
import {
	cancelSellerOrder,
	completePickupByCode,
	countSellerOrdersByStatus,
	findOpenOrderByPickupCode,
	getSellerOrder,
	listSellerOrders,
	transitionOrder,
} from "../services/orders";

export const ordersRoutes = new Elysia()
	.get(
		"/orders",
		async (ctx) => {
			const { query, accessCtx } = withSeller(ctx);
			await ensureStoreAccess(query.storeId, accessCtx);
			const result = await listSellerOrders({
				storeIds: [query.storeId],
				...query,
			});
			return okPage(result.data, result.pagination);
		},
		{
			query: t.Composite([
				OrderListQuery,
				t.Object({
					storeId: t.String({ description: "ID del negozio attivo" }),
				}),
			]),
			response: withErrors({ 200: okPageRes(SellerOrderWithRelationsSchema) }),
			detail: {
				summary: "Lista ordini venditore (negozio attivo)",
				description:
					"Restituisce gli ordini del negozio specificato, filtrati e paginati.",
				tags: ["Seller - Orders"],
			},
		},
	)
	.get(
		"/orders/counts",
		async (ctx) => {
			const { query, accessCtx } = withSeller(ctx);
			await ensureStoreAccess(query.storeId, accessCtx);
			const data = await countSellerOrdersByStatus(query);
			return ok(data);
		},
		{
			query: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
				type: t.Optional(
					t.Union(
						orderTypes.map((v) => t.Literal(v)),
						{
							description: "Filtra per tipologia",
						},
					),
				),
			}),
			response: withErrors({
				200: okRes(
					t.Record(t.String(), t.Integer({ minimum: 0 }), {
						description:
							"Numero di ordini per stato (tutti gli stati, zeri inclusi)",
					}),
				),
			}),
			detail: {
				summary: "Conteggi ordini per stato",
				description:
					"Conta gli ordini del negozio per stato, per le tab della lista ordini.",
				tags: ["Seller - Orders"],
			},
		},
	)
	.get(
		"/orders/pickup/:code",
		async (ctx) => {
			const { params, query, accessCtx } = withSeller(ctx);
			await ensureStoreAccess(query.storeId, accessCtx);
			return ok(
				await findOpenOrderByPickupCode({
					storeId: query.storeId,
					code: params.code,
				}),
			);
		},
		{
			params: t.Object({
				code: t.String({ maxLength: 20, description: "Codice di ritiro" }),
			}),
			query: t.Object({ storeId: t.String({ description: "Negozio attivo" }) }),
			response: withErrors({ 200: okRes(SellerOrderWithRelationsSchema) }),
			detail: {
				summary: "Anteprima ritiro per codice",
				description:
					"L'ordine aperto del negozio con quel codice di ritiro, da mostrare al banco prima di confermare.",
				tags: ["Seller - Orders"],
			},
		},
	)
	.post(
		"/orders/pickup",
		async (ctx) => {
			const {
				body,
				accessCtx,
				sellerProfile: sp,
				store,
				user,
			} = withSeller(ctx);
			await ensureStoreAccess(body.storeId, accessCtx);
			const data = await completePickupByCode({
				storeId: body.storeId,
				code: body.code,
				sellerProfileId: sp.id,
			});
			getLogger(store).info(
				{
					userId: user.id,
					orderId: data.id,
					action: "order_picked_up_by_code",
				},
				"Ritiro confermato al banco",
			);
			return ok(data);
		},
		{
			body: t.Object({
				storeId: t.String({ description: "Negozio attivo" }),
				code: t.String({ maxLength: 20, description: "Codice di ritiro" }),
			}),
			response: withConflictErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Conferma ritiro per codice",
				description:
					"Completa l'ordine aperto con quel codice nel negozio e accredita i punti. Una prenotazione scaduta viene fatta scadere con rimborso (400).",
				tags: ["Seller - Orders"],
			},
		},
	)
	.get(
		"/orders/:orderId",
		async (ctx) => {
			const { getAccessibleStoreIds, params } = withSeller(ctx);
			const data = await getSellerOrder({
				orderId: params.orderId,
				storeIds: await getAccessibleStoreIds(),
			});
			return ok(data);
		},
		{
			params: t.Object({
				orderId: t.String({ description: "ID dell'ordine" }),
			}),
			response: withErrors({ 200: okRes(SellerOrderWithRelationsSchema) }),
			detail: {
				summary: "Dettaglio ordine venditore",
				description:
					"Restituisce il dettaglio completo di un ordine ricevuto, inclusi articoli, cliente, negozio e indirizzo di spedizione.",
				tags: ["Seller - Orders"],
			},
		},
	)
	.patch(
		"/orders/:orderId/ready",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params } = sellerCtx;
			const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();
			const data = await transitionOrder(
				params.orderId,
				sp.id,
				"ready_for_pickup",
				accessibleStoreIds,
			);
			return ok(data);
		},
		{
			params: t.Object({
				orderId: t.String({ description: "ID dell'ordine" }),
			}),
			response: withConflictErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Segna ordine come pronto",
				description:
					"Transizione dell'ordine a 'ready_for_pickup'. Valido solo per ordini confermati di tipo pay_pickup, pay_deliver o reserve_pickup.",
				tags: ["Seller - Orders"],
			},
		},
	)
	.patch(
		"/orders/:orderId/ship",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params } = sellerCtx;
			const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();
			const data = await transitionOrder(
				params.orderId,
				sp.id,
				"shipped",
				accessibleStoreIds,
			);
			return ok(data);
		},
		{
			params: t.Object({
				orderId: t.String({ description: "ID dell'ordine" }),
			}),
			response: withConflictErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Spedisci ordine",
				description:
					"Transizione a 'shipped'. Valido solo per ordini pay_deliver in stato ready_for_pickup.",
				tags: ["Seller - Orders"],
			},
		},
	)
	.patch(
		"/orders/:orderId/complete",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params } = sellerCtx;
			const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();
			const data = await transitionOrder(
				params.orderId,
				sp.id,
				"completed",
				accessibleStoreIds,
			);
			return ok(data);
		},
		{
			params: t.Object({
				orderId: t.String({ description: "ID dell'ordine" }),
			}),
			response: withConflictErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Completa ordine",
				description:
					"Transizione a 'completed'. Le transizioni valide dipendono dal tipo e dallo stato corrente dell'ordine.",
				tags: ["Seller - Orders"],
			},
		},
	)
	.patch(
		"/orders/:orderId/cancel",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { params, store, user } = sellerCtx;
			const pino = getLogger(store);
			const data = await cancelSellerOrder({
				orderId: params.orderId,
				storeIds: await sellerCtx.getAccessibleStoreIds(),
			});
			pino.warn(
				{
					userId: user.id,
					orderId: data.id,
					orderType: data.type,
					action: "order_cancelled_by_seller",
				},
				"Ordine annullato dal negozio",
			);
			return ok(data);
		},
		{
			params: t.Object({
				orderId: t.String({ description: "ID dell'ordine" }),
			}),
			response: withConflictErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Annulla ordine",
				description:
					"Annulla un ordine in stato pending o confirmed. Lo stock torna disponibile e i punti spesi vengono restituiti al cliente.",
				tags: ["Seller - Orders"],
			},
		},
	);
