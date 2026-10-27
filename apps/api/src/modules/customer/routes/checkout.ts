import { Hono } from "hono";
import { z } from "zod";
import { requireCustomer } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { CheckoutPreviewSchema, CheckoutSchema } from "@/lib/schemas/composed";
import { StoreReservationDeadlineSchema } from "@/lib/schemas/entities";
import { okRes, withConflictErrors, withErrors } from "@/lib/schemas/responses";
import { zFormat, zString } from "@/lib/schemas/t";
import { customerSecurity } from "../context";
import {
	createCheckout,
	getCheckout,
	parseStoresParam,
	previewCheckout,
	reservationDeadlinesForStores,
} from "../services/checkout";

const DeadlinesResponse = okRes(z.array(StoreReservationDeadlineSchema));
const PreviewResponse = okRes(CheckoutPreviewSchema);
const CheckoutResponse = okRes(CheckoutSchema);

export const checkoutRoutes = new Hono()
	.get(
		"/checkout/reservation-deadlines",
		doc({
			response: withErrors({ 200: DeadlinesResponse }),
			detail: {
				summary: "Scadenze delle prenotazioni",
				description:
					"Per ogni negozio visibile: ore di ritiro, scadenza che avrebbe una prenotazione «Prenota e paga in negozio» confermata adesso e tipo di conteggio (ore di apertura, o calendario se il negozio non ha orari). I negozi sconosciuti o non visibili sono omessi.",
				tags: ["Customer - Checkout"],
				...customerSecurity,
			},
		}),
		v(
			"query",
			z.object({
				storeIds: zString({
					maxLength: 2000,
					description: "ID dei negozi separati da virgola (al massimo 50)",
				}),
			}),
		),
		requireCustomer,
		async (c) => {
			const ids = [
				...new Set(c.req.valid("query").storeIds.split(",").filter(Boolean)),
			].slice(0, 50);
			return send(
				c,
				DeadlinesResponse,
				ok(await reservationDeadlinesForStores(ids)),
			);
		},
	)
	.get(
		"/checkout/preview",
		doc({
			response: withConflictErrors({ 200: PreviewResponse }),
			detail: {
				summary: "Anteprima checkout",
				description:
					"Gli importi del checkout con e senza punti, senza creare niente. Stessi rifiuti della conferma: 409 se il carrello è cambiato, 400 se una modalità non è offerta. Sotto il minimo online risponde 200 con `withoutPoints.belowMinimum: true`.",
				tags: ["Customer - Checkout"],
				...customerSecurity,
			},
		}),
		v(
			"query",
			z.object({
				stores: zString({
					maxLength: 5000,
					description:
						"Scelta per negozio, `storeId:tipo` separati da virgola (tipo: reserve_pickup | pay_pickup)",
				}),
			}),
		),
		requireCustomer,
		async (c) => {
			const cp = c.var.customerProfile;
			return send(
				c,
				PreviewResponse,
				ok(
					await previewCheckout({
						customerProfileId: cp.id,
						customerPoints: cp.points,
						stores: parseStoresParam(c.req.valid("query").stores),
					}),
				),
			);
		},
	)
	.post(
		"/checkout",
		doc({
			response: withConflictErrors({ 200: CheckoutResponse }),
			detail: {
				summary: "Conferma checkout",
				description:
					"Crea un ordine per ogni negozio scelto, leggendo le righe dal carrello, in un'unica transazione. Le righe ordinate escono dal carrello; quelle non disponibili restano. 409 se il carrello è cambiato. Con ordini Paga e ritira crea un unico pagamento: la risposta porta `payment.clientSecret`. 502 se il pagamento online non è disponibile. Con `usePoints` gli ordini Paga e ritira possono arrivare a 0 €: in quel caso nascono confermati e `payment` è null. 400 se l'importo online è tra 0,01 € e il minimo Stripe (0,50 €).",
				tags: ["Customer - Checkout"],
				...customerSecurity,
			},
		}),
		v(
			"json",
			z.object({
				idempotencyKey: zFormat("uuid").meta({
					description:
						"UUID generato dal client per questa conferma: richieste ripetute restituiscono lo stesso checkout",
				}),
				stores: z
					.array(
						z.object({
							storeId: z.string().meta({ description: "ID del negozio" }),
							type: z.enum(["reserve_pickup", "pay_pickup"]).meta({
								description: "Modalità d'acquisto scelta per il negozio",
							}),
						}),
					)
					.min(1)
					.max(50)
					.meta({ description: "Negozi del carrello da ordinare" }),
				usePoints: z
					.boolean()
					.meta({
						description:
							"Usa i punti sugli ordini Paga e ritira: il server decide quanti (saldo, regola 0 € o almeno 0,50 €) e li ripartisce tra i negozi",
					})
					.optional(),
			}),
		),
		requireCustomer,
		async (c) => {
			const cp = c.var.customerProfile;
			const data = await createCheckout({
				customerProfileId: cp.id,
				customerPoints: cp.points,
				...c.req.valid("json"),
			});
			logger.info(
				{
					userId: c.var.user.id,
					customerProfileId: cp.id,
					checkoutId: data.id,
					orderCount: data.orders.length,
					amountDueOnline: data.amountDueOnline,
					action: "checkout_created",
				},
				"Checkout creato",
			);
			return send(c, CheckoutResponse, ok(data));
		},
	)
	.get(
		"/checkouts/:checkoutId",
		doc({
			response: withErrors({ 200: CheckoutResponse }),
			detail: {
				summary: "Dettaglio checkout",
				description:
					"Il checkout con i suoi ordini (pagina di ordine effettuato).",
				tags: ["Customer - Checkout"],
				...customerSecurity,
			},
		}),
		v("param", z.object({ checkoutId: z.string() })),
		requireCustomer,
		async (c) =>
			send(
				c,
				CheckoutResponse,
				ok(
					await getCheckout({
						checkoutId: c.req.valid("param").checkoutId,
						customerProfileId: c.var.customerProfile.id,
					}),
				),
			),
	);
