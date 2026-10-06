import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import {
	CheckoutPreviewSchema,
	CheckoutSchema,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withCustomer } from "../context";
import {
	createCheckout,
	getCheckout,
	parseStoresParam,
	previewCheckout,
} from "../services/checkout";

export const checkoutRoutes = new Elysia()
	.get(
		"/checkout/preview",
		async (ctx) => {
			const { customerProfile: cp, query } = withCustomer(ctx);
			return ok(
				await previewCheckout({
					customerProfileId: cp.id,
					customerPoints: cp.points,
					stores: parseStoresParam(query.stores),
				}),
			);
		},
		{
			query: t.Object({
				stores: t.String({
					description:
						"Scelta per negozio, `storeId:tipo` separati da virgola (tipo: reserve_pickup | pay_pickup)",
				}),
			}),
			response: withConflictErrors({ 200: okRes(CheckoutPreviewSchema) }),
			detail: {
				summary: "Anteprima checkout",
				description:
					"Gli importi del checkout con e senza punti, senza creare niente. Stessi rifiuti della conferma: 409 se il carrello è cambiato, 400 se una modalità non è offerta.",
				tags: ["Customer - Checkout"],
			},
		},
	)
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
					amountDueOnline: data.amountDueOnline,
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
				usePoints: t.Optional(
					t.Boolean({
						description:
							"Usa i punti sugli ordini Paga e ritira: il server decide quanti (saldo, regola 0 € o almeno 0,50 €) e li ripartisce tra i negozi",
					}),
				),
			}),
			response: withConflictErrors({ 200: okRes(CheckoutSchema) }),
			detail: {
				summary: "Conferma checkout",
				description:
					"Crea un ordine per ogni negozio scelto, leggendo le righe dal carrello, in un'unica transazione. Le righe ordinate escono dal carrello; quelle non disponibili restano. 409 se il carrello è cambiato. Con ordini Paga e ritira crea un unico pagamento: la risposta porta `payment.clientSecret`. 502 se il pagamento online non è disponibile. Con `usePoints` gli ordini Paga e ritira possono arrivare a 0 €: in quel caso nascono confermati e `payment` è null.",
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
