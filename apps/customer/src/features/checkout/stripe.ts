import { loadStripe, type Stripe } from "@stripe/stripe-js";

const KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

let promise: Promise<Stripe | null> | undefined;

/** Stripe.js caricato una volta sola, solo lato client. null senza chiave. */
export function getStripe(): Promise<Stripe | null> | null {
	if (!KEY) return null;
	promise ??= loadStripe(KEY);
	return promise;
}
