import Stripe from "stripe";
import { env } from "@/lib/env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
	apiVersion: "2026-05-27.dahlia",
	typescript: true,
	appInfo: {
		name: "bibs",
		url: "https://bibs.app",
	},
});
