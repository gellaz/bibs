import { Elysia } from "elysia";
import { logger } from "@/lib/logger";
import { handleStripeWebhook } from "../services/dispatcher";

export const stripeWebhookRoutes = new Elysia().post(
	"/webhooks/stripe",
	async (ctx) => {
		const signature = ctx.headers["stripe-signature"];
		if (!signature) {
			ctx.set.status = 400;
			return { error: "missing signature" };
		}

		// Read the raw body directly from the underlying Request, bypassing any
		// Elysia body parsing. Stripe's HMAC verifies the EXACT bytes that were
		// signed — any re-serialization (even JSON.stringify on a parsed object)
		// changes whitespace/key order and breaks the signature.
		const payload = await ctx.request.text();

		try {
			await handleStripeWebhook({ payload, signature });
			return { received: true };
		} catch (err) {
			logger.error({ err }, "Stripe webhook processing failed");
			const message = err instanceof Error ? err.message.toLowerCase() : "";
			if (message.includes("signature")) {
				ctx.set.status = 400;
				return { error: "invalid signature" };
			}
			// Return 5xx on handler failure so Stripe redelivers the event (with
			// backoff, for ~3 days). The dispatcher's dedup ledger gates on
			// processed_at, so each redelivery re-runs the handler until it
			// succeeds; a permanently failing event surfaces in the Stripe
			// dashboard for manual inspection instead of being silently dropped.
			ctx.set.status = 500;
			return { error: "internal error" };
		}
	},
	{
		// Disable Elysia body parsing entirely — we read the raw text ourselves.
		parse: "none",
		detail: {
			summary: "Webhook Stripe",
			description:
				"Endpoint pubblico per eventi Stripe. Firma obbligatoria nell'header stripe-signature.",
			tags: ["Webhooks"],
		},
	},
);
