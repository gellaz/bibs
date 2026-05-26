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

		const payload =
			typeof ctx.body === "string" ? ctx.body : JSON.stringify(ctx.body);

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
		parse: "text",
		detail: {
			summary: "Webhook Stripe",
			description:
				"Endpoint pubblico per eventi Stripe. Firma obbligatoria nell'header stripe-signature.",
			tags: ["Webhooks"],
		},
	},
);
