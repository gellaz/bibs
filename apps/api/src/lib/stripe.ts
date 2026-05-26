import Stripe from "stripe";
import { env } from "@/lib/env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
	apiVersion: "2026-04-22.dahlia",
	typescript: true,
	appInfo: {
		name: "bibs",
		url: "https://bibs.app",
	},
});
