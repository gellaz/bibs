import { Elysia, t } from "elysia";
import { ServiceError } from "@/lib/errors";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas";
import { CreateStoreBody } from "@/lib/schemas/forms";
import { withSeller } from "../context";
import {
	createCheckoutSession,
	getCheckoutStatus,
	getPendingForResume,
} from "../services/checkout";

const CheckoutResponseSchema = t.Object({
	checkoutUrl: t.String(),
	pendingStoreCreationId: t.String(),
});

const CheckoutStatusSchema = t.Object({
	status: t.Union([
		t.Literal("open"),
		t.Literal("ready"),
		t.Literal("expired"),
		t.Literal("canceled"),
	]),
	storeId: t.Optional(t.String()),
});

const PendingFormSchema = t.Object({
	formData: t.Unknown(),
});

export const checkoutRoutes = new Elysia()
	.post(
		"/stores/checkout",
		async (ctx) => {
			const { sellerProfile: sp, body } = withSeller(ctx);
			if (sp.onboardingStatus !== "active") {
				throw new ServiceError(403, "Seller must be active to add stores");
			}
			const data = await createCheckoutSession({
				sellerProfileId: sp.id,
				body,
			});
			return ok(data);
		},
		{
			body: CreateStoreBody,
			response: withErrors({ 200: okRes(CheckoutResponseSchema) }),
			detail: {
				summary: "Crea checkout session per nuovo negozio",
				description:
					"Crea una Stripe Checkout in mode subscription. Il negozio viene creato dal webhook a pagamento avvenuto.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.get(
		"/checkout-sessions/:sessionId/status",
		async (ctx) => {
			const { sellerProfile: sp, params } = withSeller(ctx);
			const data = await getCheckoutStatus({
				sellerProfileId: sp.id,
				stripeCheckoutSessionId: params.sessionId,
			});
			return ok(data);
		},
		{
			params: t.Object({ sessionId: t.String() }),
			response: withErrors({ 200: okRes(CheckoutStatusSchema) }),
			detail: {
				summary: "Stato della checkout session",
				description: "Polling endpoint per la pagina /store/new/processing.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.get(
		"/stores/checkout/:pendingId",
		async (ctx) => {
			const { sellerProfile: sp, params } = withSeller(ctx);
			const data = await getPendingForResume({
				sellerProfileId: sp.id,
				pendingId: params.pendingId,
			});
			return ok(data);
		},
		{
			params: t.Object({ pendingId: t.String() }),
			response: withErrors({ 200: okRes(PendingFormSchema) }),
			detail: {
				summary: "Recupera form data per cancel flow",
				description:
					"Usato per ripopolare il form quando l'utente torna da checkout cancellato.",
				tags: ["Seller - Stores"],
			},
		},
	);
