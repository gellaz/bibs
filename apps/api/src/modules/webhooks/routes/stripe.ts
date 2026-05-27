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
			// Return 200 even on handler errors to avoid Stripe infinite retries.
			// stripe_events row stays with processedAt=null → can be reprocessed manually.
			ctx.set.status = 200;
			return { received: true, internalError: true };
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
