import { moduleApp } from "@/http/app";
import { stripeWebhookRoutes } from "./routes/stripe";

/** Sub-app Hono del modulo, montata su /webhooks in `src/index.ts`. */
export const webhooksApp = moduleApp().route("/", stripeWebhookRoutes);
