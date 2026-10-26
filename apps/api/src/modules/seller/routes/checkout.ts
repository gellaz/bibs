import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { ServiceError } from "@/lib/errors";
import { ok } from "@/lib/responses";
import { CreateStoreBody } from "@/lib/zod/forms/stores";
import { okRes, withConflictErrors, withErrors } from "@/lib/zod/responses";
import { requireOwner } from "../context";
import {
	createCheckoutSession,
	createReactivationCheckoutSession,
	getCheckoutStatus,
	getPendingForResume,
} from "../services/checkout";

const security = [{ bearerAuth: [] }];
const tags = ["Seller - Stores"];

const CheckoutRes = okRes(
	z.object({
		checkoutUrl: z.string(),
		pendingStoreCreationId: z.string(),
	}),
);

const CheckoutStatusRes = okRes(
	z.object({
		status: z.enum(["open", "ready", "expired", "canceled"]),
		storeId: z.string().optional(),
	}),
);

const PendingFormRes = okRes(z.object({ formData: z.unknown() }));

const ReactivationRes = okRes(z.object({ checkoutUrl: z.string() }));

const inactive = () =>
	new ServiceError(
		403,
		"Per aggiungere negozi l'account venditore deve essere attivo",
	);

export const checkoutRoutes = new Hono()
	.post(
		"/stores/checkout",
		doc({
			response: withErrors({ 200: CheckoutRes }),
			detail: {
				summary: "Crea checkout session per nuovo negozio",
				description:
					"Crea una Stripe Checkout in mode subscription. Il negozio viene creato dal webhook a pagamento avvenuto.",
				tags,
				security,
			},
		}),
		v("json", CreateStoreBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			if (sp.onboardingStatus !== "active") throw inactive();
			const data = await createCheckoutSession({
				sellerProfileId: sp.id,
				body: c.req.valid("json"),
			});
			return send(c, CheckoutRes, ok(data));
		},
	)
	.get(
		"/checkout-sessions/:sessionId/status",
		doc({
			response: withErrors({ 200: CheckoutStatusRes }),
			detail: {
				summary: "Stato della checkout session",
				description: "Polling endpoint per la pagina /store/new/processing.",
				tags,
				security,
			},
		}),
		v("param", z.object({ sessionId: z.string() })),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await getCheckoutStatus({
				sellerProfileId: sp.id,
				stripeCheckoutSessionId: c.req.valid("param").sessionId,
			});
			return send(c, CheckoutStatusRes, ok(data));
		},
	)
	.get(
		"/stores/checkout/:pendingId",
		doc({
			response: withErrors({ 200: PendingFormRes }),
			detail: {
				summary: "Recupera form data per cancel flow",
				description:
					"Usato per ripopolare il form quando l'utente torna da checkout cancellato.",
				tags,
				security,
			},
		}),
		v("param", z.object({ pendingId: z.string() })),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await getPendingForResume({
				sellerProfileId: sp.id,
				pendingId: c.req.valid("param").pendingId,
			});
			return send(c, PendingFormRes, ok(data));
		},
	)
	.post(
		"/stores/:storeId/reactivation-checkout",
		doc({
			response: withConflictErrors({ 200: ReactivationRes }),
			detail: {
				summary: "Checkout per riattivare un negozio cancellato",
				description:
					"Crea una Stripe Checkout in mode subscription (stesso prezzo della creazione negozio) per un negozio con abbonamento 'canceled'. A pagamento avvenuto il webhook toglie il negozio dall'archivio con prodotti, orari e immagini invariati. 409 se il negozio non è cancellato. Solo il titolare.",
				tags,
				security,
			},
		}),
		v(
			"param",
			z.object({
				storeId: z.string().meta({ description: "ID del negozio archiviato" }),
			}),
		),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			if (sp.onboardingStatus !== "active") throw inactive();
			const data = await createReactivationCheckoutSession({
				sellerProfileId: sp.id,
				storeId: c.req.valid("param").storeId,
			});
			return send(c, ReactivationRes, ok(data));
		},
	);
