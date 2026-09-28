import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { env } from "@/env";

let promise: Promise<Stripe | null> | undefined;

/** Stripe.js caricato una volta sola, solo lato client. null senza chiave. */
export function getStripe(): Promise<Stripe | null> | null {
	if (!env.VITE_STRIPE_PUBLISHABLE_KEY) return null;
	promise ??= loadStripe(env.VITE_STRIPE_PUBLISHABLE_KEY);
	return promise;
}
