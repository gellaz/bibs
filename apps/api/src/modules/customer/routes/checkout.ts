import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import {
	CheckoutSchema,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withCustomer } from "../context";
import { createCheckout, getCheckout } from "../services/checkout";

export const checkoutRoutes = new Elysia()
	.post(
		"/checkout",
		async (ctx) => {
			const { customerProfile: cp, body, store, user } = withCustomer(ctx);
			const pino = getLogger(store);
			const data = await createCheckout({
				customerProfileId: cp.id,
				customerPoints: cp.points,
				...body,
			});
			pino.info(
				{
					userId: user.id,
					customerProfileId: cp.id,
					checkoutId: data.id,
					orderCount: data.orders.length,
					action: "checkout_created",
				},
				"Checkout creato",
			);
			return ok(data);
		},
		{
			body: t.Object({
				idempotencyKey: t.String({
					format: "uuid",
					description:
						"UUID generato dal client per questa conferma: richieste ripetute restituiscono lo stesso checkout",
				}),
				stores: t.Array(
					t.Object({
						storeId: t.String({ description: "ID del negozio" }),
						type: t.Union(
							[t.Literal("reserve_pickup"), t.Literal("pay_pickup")],
							{ description: "Modalità d'acquisto scelta per il negozio" },
						),
					}),
					{ minItems: 1, description: "Negozi del carrello da ordinare" },
				),
			}),
			response: withConflictErrors({ 200: okRes(CheckoutSchema) }),
			detail: {
				summary: "Conferma checkout",
				description:
					"Crea un ordine per ogni negozio scelto, leggendo le righe dal carrello, in un'unica transazione. Le righe ordinate escono dal carrello; quelle non disponibili restano. 409 se il carrello è cambiato.",
				tags: ["Customer - Checkout"],
			},
		},
	)
	.get(
		"/checkouts/:checkoutId",
		async (ctx) => {
			const { customerProfile: cp, params } = withCustomer(ctx);
			return ok(
				await getCheckout({
					checkoutId: params.checkoutId,
					customerProfileId: cp.id,
				}),
			);
		},
		{
			params: t.Object({ checkoutId: t.String() }),
			response: withErrors({ 200: okRes(CheckoutSchema) }),
			detail: {
				summary: "Dettaglio checkout",
				description:
					"Il checkout con i suoi ordini (pagina di ordine effettuato).",
				tags: ["Customer - Checkout"],
			},
		},
	);
