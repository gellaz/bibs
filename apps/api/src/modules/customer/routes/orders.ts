import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { OrderListQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	CustomerOrderWithRelationsSchema,
	OrderSchema,
	okPageRes,
	okRes,
	withErrors,
} from "@/lib/schemas";
import { withCustomer } from "../context";
import {
	cancelOrder,
	createOrder,
	getCustomerOrder,
	listCustomerOrders,
	pickupOrder,
} from "../services/orders";

export const ordersRoutes = new Elysia()
	.post(
		"/orders",
		async (ctx) => {
			const { customerProfile: cp, body, store, user } = withCustomer(ctx);
			const pino = getLogger(store);

			const data = await createOrder({
				customerProfileId: cp.id,
				customerPoints: cp.points,
				...body,
			});

			pino.info(
				{
					userId: user.id,
					customerProfileId: cp.id,
					orderId: data.id,
					orderType: data.type,
					storeId: data.storeId,
					total: data.total,
					itemCount: body.items.length,
					pointsSpent: body.pointsToSpend || 0,
					action: "order_created",
				},
				`Ordine creato: ${data.type}`,
			);

			return ok(data);
		},
		{
			body: t.Object({
				type: t.Union(
					[
						t.Literal("direct"),
						t.Literal("reserve_pickup"),
						t.Literal("pay_pickup"),
						t.Literal("pay_deliver"),
					],
					{
						description:
							"Tipo di ordine: direct (acquisto diretto), reserve_pickup (riserva e ritira), pay_pickup (paga e ritira), pay_deliver (paga e consegna)",
					},
				),
				storeId: t.String({ description: "ID del negozio" }),
				items: t.Array(
					t.Object({
						storeProductId: t.String({ description: "ID dello store_product" }),
						quantity: t.Number({ minimum: 1, description: "Quantità" }),
					}),
					{ minItems: 1, description: "Articoli dell'ordine (almeno uno)" },
				),
				shippingAddressId: t.Optional(
					t.String({
						description:
							"ID indirizzo di spedizione (obbligatorio per pay_deliver)",
					}),
				),
				pointsToSpend: t.Optional(
					t.Number({
						minimum: 0,
						description: "Punti fedeltà da utilizzare come sconto",
					}),
				),
				idempotencyKey: t.Optional(
					t.String({
						format: "uuid",
						description:
							"UUID di idempotenza. Se fornito, richieste duplicate con la stessa key restituiscono l'ordine già creato.",
					}),
				),
			}),
			response: withErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Crea ordine",
				description:
					"Crea un nuovo ordine. Lo stock viene decrementato atomicamente. I punti fedeltà vengono accreditati/addebitati in base alla configurazione. Supporta idempotenza tramite il campo idempotencyKey.",
				tags: ["Customer - Orders"],
			},
		},
	)
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
		"/orders/:orderId/pickup",
		async (ctx) => {
			const { customerProfile: cp, params, store, user } = withCustomer(ctx);
			const pino = getLogger(store);

			const data = await pickupOrder({
				orderId: params.orderId,
				customerProfileId: cp.id,
			});

			pino.info(
				{
					userId: user.id,
					customerProfileId: cp.id,
					orderId: data.id,
					orderType: data.type,
					action: "order_picked_up",
				},
				"Ordine ritirato dal cliente",
			);

			return ok(data);
		},
		{
			params: t.Object({
				orderId: t.String({ description: "ID dell'ordine" }),
			}),
			response: withErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Ritira ordine",
				description:
					"Conferma il ritiro di un ordine di tipo pickup. L'ordine deve essere in stato 'ready_for_pickup'.",
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
			response: withErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Annulla ordine",
				description:
					"Annulla un ordine. Lo stock viene ripristinato e i punti eventualmente spesi vengono restituiti.",
				tags: ["Customer - Orders"],
			},
		},
	);
