#!/usr/bin/env bun
/**
 * One-time Stripe bootstrap: creates a recurring Product+Price in test mode
 * and prints the IDs to copy into .env.local (STRIPE_DEV_PRICE_ID).
 *
 * Idempotent: searches by metadata.bibs_role='store_monthly_fee' before creating.
 *
 * Usage:
 *   bun run stripe:bootstrap
 */

import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
	console.error("ERROR: STRIPE_SECRET_KEY not set in env");
	process.exit(1);
}

const stripe = new Stripe(secret, { apiVersion: "2026-05-27.dahlia" });

const PRODUCT_METADATA_KEY = "bibs_role";
const PRODUCT_METADATA_VALUE = "store_monthly_fee";
const DEFAULT_FEE_CENTS = 2900; // €29
const CURRENCY = "eur";

async function findExistingProduct() {
	const products = await stripe.products.search({
		query: `metadata['${PRODUCT_METADATA_KEY}']:'${PRODUCT_METADATA_VALUE}'`,
	});
	return products.data[0] ?? null;
}

async function findActivePrice(productId: string) {
	const prices = await stripe.prices.list({
		product: productId,
		active: true,
		limit: 1,
	});
	return prices.data[0] ?? null;
}

async function main() {
	let product = await findExistingProduct();
	if (!product) {
		product = await stripe.products.create({
			name: "bibs - Quota mensile per negozio",
			description: "Abbonamento mensile per ogni punto vendita gestito su bibs",
			metadata: { [PRODUCT_METADATA_KEY]: PRODUCT_METADATA_VALUE },
		});
		console.log(`Created Product: ${product.id}`);
	} else {
		console.log(`Found existing Product: ${product.id}`);
	}

	let price = await findActivePrice(product.id);
	if (!price) {
		price = await stripe.prices.create({
			product: product.id,
			unit_amount: DEFAULT_FEE_CENTS,
			currency: CURRENCY,
			recurring: { interval: "month" },
		});
		console.log(
			`Created Price: ${price.id} (${DEFAULT_FEE_CENTS / 100} EUR/mo)`,
		);
	} else {
		console.log(`Found existing active Price: ${price.id}`);
	}

	console.log("");
	console.log("Add to apps/api/.env.local:");
	console.log(`STRIPE_DEV_PRICE_ID=${price.id}`);
	console.log("");
	console.log(`Default fee (cents): ${DEFAULT_FEE_CENTS}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
