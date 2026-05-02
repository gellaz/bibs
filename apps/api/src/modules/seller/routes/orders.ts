import { Elysia, t } from "elysia";
import { OrderListQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	OrderSchema,
	okPageRes,
	okRes,
	SellerOrderWithRelationsSchema,
	withErrors,
} from "@/lib/schemas";
import { withSeller } from "../context";
import {
	getSellerOrder,
	listSellerOrders,
	transitionOrder,
} from "../services/orders";

export const ordersRoutes = new Elysia()
	.get(
		"/orders",
		async (ctx) => {
			const { getAccessibleStoreIds, query } = withSeller(ctx);
			const result = await listSellerOrders({
				storeIds: await getAccessibleStoreIds(),
				...query,
			});
			return okPage(result.data, result.pagination);
		},
		{
			query: OrderListQuery,
			response: withErrors({ 200: okPageRes(SellerOrderWithRelationsSchema) }),
			detail: {
				summary: "Lista ordini venditore",
				description:
					"Restituisce tutti gli ordini ricevuti dai negozi del venditore, ordinati per data decrescente. Include articoli, cliente e negozio. Filtrabile per stato e tipo.",
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
			response: withErrors({ 200: okRes(OrderSchema) }),
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
			response: withErrors({ 200: okRes(OrderSchema) }),
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
			response: withErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Completa ordine",
				description:
					"Transizione a 'completed'. Le transizioni valide dipendono dal tipo e dallo stato corrente dell'ordine.",
				tags: ["Seller - Orders"],
			},
		},
	);
