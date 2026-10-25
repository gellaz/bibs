import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { OrderListQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	CustomerOrderWithRelationsSchema,
	OrderSchema,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withCustomer } from "../context";
import {
	cancelOrder,
	getCustomerOrder,
	listCustomerOrders,
} from "../services/orders";

export const ordersRoutes = new Elysia()
	.get(
		"/orders",
		async (ctx) => {
			const { customerProfile: cp, query } = withCustomer(ctx);
			const result = await listCustomerOrders({
				customerProfileId: cp.id,
				...query,
			});
			return okPage(result.data, result.pagination);
		},
		{
			query: OrderListQuery,
			response: withErrors({
				200: okPageRes(CustomerOrderWithRelationsSchema),
			}),
			detail: {
				summary: "Lista ordini cliente",
				description:
					"Restituisce gli ordini del cliente ordinati per data decrescente, con articoli, negozio e indirizzo di spedizione. Filtrabile per stato e tipo.",
				tags: ["Customer - Orders"],
			},
		},
	)
	.get(
		"/orders/:orderId",
		async (ctx) => {
			const { customerProfile: cp, params } = withCustomer(ctx);
			const data = await getCustomerOrder({
				orderId: params.orderId,
				customerProfileId: cp.id,
			});
			return ok(data);
		},
		{
			params: t.Object({
				orderId: t.String({ description: "ID dell'ordine" }),
			}),
			response: withErrors({ 200: okRes(CustomerOrderWithRelationsSchema) }),
			detail: {
				summary: "Dettaglio ordine",
				description:
					"Restituisce i dettagli completi di un singolo ordine del cliente.",
				tags: ["Customer - Orders"],
			},
		},
	)
	.post(
		"/orders/:orderId/cancel",
		async (ctx) => {
			const { customerProfile: cp, params, store, user } = withCustomer(ctx);
			const pino = getLogger(store);

			const data = await cancelOrder({
				orderId: params.orderId,
				customerProfileId: cp.id,
			});

			pino.warn(
				{
					userId: user.id,
					customerProfileId: cp.id,
					orderId: data.id,
					orderType: data.type,
					action: "order_cancelled",
				},
				"Ordine annullato dal cliente",
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
					"Annulla un ordine. Lo stock torna disponibile e i punti spesi vengono restituiti; un ordine pagato online viene rimborsato. 409 se è in attesa di pagamento.",
				tags: ["Customer - Orders"],
			},
		},
	);
