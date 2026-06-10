import Stripe from "stripe";
import { env } from "@/lib/env";

let instance: Stripe | undefined;

/** Build the Stripe client on first use, not at module-evaluation time. */
function client(): Stripe {
	if (!instance) {
		instance = new Stripe(env.STRIPE_SECRET_KEY, {
			apiVersion: "2026-05-27.dahlia",
			typescript: true,
			appInfo: {
				name: "bibs",
				url: "https://bibs.app",
			},
		});
	}
	return instance;
}

/**
 * Lazy Stripe singleton. Constructing the client at module load coupled every
 * importer to `env.STRIPE_SECRET_KEY` being present the instant `@/lib/stripe`
 * is evaluated. Because bun's `mock.module("@/lib/env", …)` is process-global,
 * a test supplying a partial env (no STRIPE_SECRET_KEY) would make this module
 * re-evaluate and throw "Neither apiKey nor config.authenticator provided" as
 * an order-dependent "unhandled error between tests" (green locally, red on CI).
 *
 * The Proxy defers `new Stripe()` to the first property access, so merely
 * evaluating the module never touches the key. The public `stripe.*` surface is
 * identical for consumers.
 */
export const stripe: Stripe = new Proxy({} as Stripe, {
	get(_target, prop) {
		const c = client();
		const value = Reflect.get(c, prop, c);
		return typeof value === "function" ? value.bind(c) : value;
	},
});
