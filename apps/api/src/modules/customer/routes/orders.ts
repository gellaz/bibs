import { Hono } from "hono";
import { z } from "zod";
import { requireCustomer } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okPage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { CustomerOrderWithRelationsSchema } from "@/lib/schemas/composed";
import { OrderSchema } from "@/lib/schemas/entities";
import { OrderListQuery } from "@/lib/schemas/queries";
import {
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas/responses";
import { customerSecurity } from "../context";
import {
	cancelOrder,
	getCustomerOrder,
	listCustomerOrders,
} from "../services/orders";

const OrderPage = okPageRes(CustomerOrderWithRelationsSchema);
const OrderResponse = okRes(CustomerOrderWithRelationsSchema);
const CancelResponse = okRes(OrderSchema);
const OrderParams = z.object({
	orderId: z.string().meta({ description: "ID dell'ordine" }),
});

export const ordersRoutes = new Hono()
	.get(
		"/orders",
		doc({
			response: withErrors({ 200: OrderPage }),
			detail: {
				summary: "Lista ordini cliente",
				description:
					"Restituisce gli ordini del cliente ordinati per data decrescente, con articoli, negozio e indirizzo di spedizione. Filtrabile per stato e tipo.",
				tags: ["Customer - Orders"],
				...customerSecurity,
			},
		}),
		v("query", OrderListQuery),
		requireCustomer,
		async (c) => {
			const result = await listCustomerOrders({
				customerProfileId: c.var.customerProfile.id,
				...c.req.valid("query"),
			});
			return send(c, OrderPage, okPage(result.data, result.pagination));
		},
	)
	.get(
		"/orders/:orderId",
		doc({
			response: withErrors({ 200: OrderResponse }),
			detail: {
				summary: "Dettaglio ordine",
				description:
					"Restituisce i dettagli completi di un singolo ordine del cliente.",
				tags: ["Customer - Orders"],
				...customerSecurity,
			},
		}),
		v("param", OrderParams),
		requireCustomer,
		async (c) => {
			const data = await getCustomerOrder({
				orderId: c.req.valid("param").orderId,
				customerProfileId: c.var.customerProfile.id,
			});
			return send(c, OrderResponse, ok(data));
		},
	)
	.post(
		"/orders/:orderId/cancel",
		doc({
			response: withConflictErrors({ 200: CancelResponse }),
			detail: {
				summary: "Annulla ordine",
				description:
					"Annulla un ordine. Lo stock torna disponibile e i punti spesi vengono restituiti; un ordine pagato online viene rimborsato. 409 se è in attesa di pagamento.",
				tags: ["Customer - Orders"],
				...customerSecurity,
			},
		}),
		v("param", OrderParams),
		requireCustomer,
		async (c) => {
			const cp = c.var.customerProfile;
			const data = await cancelOrder({
				orderId: c.req.valid("param").orderId,
				customerProfileId: cp.id,
			});

			logger.warn(
				{
					userId: c.var.user.id,
					customerProfileId: cp.id,
					orderId: data.id,
					orderType: data.type,
					action: "order_cancelled",
				},
				"Ordine annullato dal cliente",
			);

			return send(c, CancelResponse, ok(data));
		},
	);
