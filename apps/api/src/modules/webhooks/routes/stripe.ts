import { type Context, Hono } from "hono";
import { doc } from "@/http/openapi";
import { publicRoute } from "@/http/routes";
import { json } from "@/http/send";
import { logger } from "@/lib/logger";
import { handleStripeWebhook } from "../services/dispatcher";

// Corpi fuori dall'inviluppo standard (`{ error }`, `{ received }`), come li
// legge Stripe: niente `send()` né schema di risposta.
function receive(scope: "platform" | "connect" | "thin") {
	return async (c: Context) => {
		const signature = c.req.header("stripe-signature");
		if (!signature) return json(c, { error: "missing signature" }, 400);

		// Read the raw body, with nothing parsing it first (no `v()`, no body
		// middleware; the Elysia mount doesn't read it either). Stripe's HMAC
		// verifies the EXACT bytes that were signed — any re-serialization (even
		// JSON.stringify on a parsed object) changes whitespace/key order and
		// breaks the signature.
		const payload = await c.req.text();

		try {
			await handleStripeWebhook({ payload, signature, scope });
			return json(c, { received: true }, 200);
		} catch (err) {
			logger.error({ err }, "Stripe webhook processing failed");
			const message = err instanceof Error ? err.message.toLowerCase() : "";
			if (message.includes("signature"))
				return json(c, { error: "invalid signature" }, 400);
			// Return 5xx on handler failure so Stripe redelivers the event (with
			// backoff, for ~3 days). The dispatcher's dedup ledger gates on
			// processed_at, so each redelivery re-runs the handler until it
			// succeeds; a permanently failing event surfaces in the Stripe
			// dashboard for manual inspection instead of being silently dropped.
			return json(c, { error: "internal error" }, 500);
		}
	};
}

const webhookDoc = (summary: string, description: string) =>
	doc({ detail: { summary, description, tags: ["Webhooks"] } });

// Route relative: il modulo è montato su /webhooks (`src/index.ts`). Pubbliche:
// l'autenticità la dà la firma Stripe.
export const stripeWebhookRoutes = new Hono()
	.post(
		"/stripe",
		webhookDoc(
			"Webhook Stripe",
			"Endpoint pubblico per eventi Stripe. Firma obbligatoria nell'header stripe-signature.",
		),
		publicRoute,
		receive("platform"),
	)
	.post(
		"/stripe/connect",
		webhookDoc(
			"Webhook Stripe Connect",
			"Eventi dei conti collegati (account.updated). Firma verificata con STRIPE_CONNECT_WEBHOOK_SECRET.",
		),
		publicRoute,
		receive("connect"),
	)
	.post(
		"/stripe/thin",
		webhookDoc(
			"Webhook Stripe thin events",
			"Thin events v2 dei conti collegati (capability e requisiti Accounts v2). Firma verificata con STRIPE_THIN_WEBHOOK_SECRET.",
		),
		publicRoute,
		receive("thin"),
	);
