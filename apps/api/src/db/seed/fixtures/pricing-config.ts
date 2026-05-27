import { db } from "@/db";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { env } from "@/lib/env";

export async function seedPricingConfig() {
	const existing = await db.query.pricingConfig.findFirst();
	if (existing) {
		console.log("[seed] pricing_config already exists, skipping");
		return;
	}

	if (!env.STRIPE_DEV_PRICE_ID) {
		console.warn(
			"[seed] STRIPE_DEV_PRICE_ID not set, skipping pricing_config seed. Run `bun run stripe:bootstrap` first.",
		);
		return;
	}

	await db.insert(pricingConfig).values({
		storeMonthlyFeeCents: 2900,
		currency: "EUR",
		stripePriceId: env.STRIPE_DEV_PRICE_ID,
		suspendedAutoCancelDays: 60,
		pendingCreationExpiryHours: 24,
		isActive: true,
	});
	console.log("[seed] pricing_config seeded");
}
