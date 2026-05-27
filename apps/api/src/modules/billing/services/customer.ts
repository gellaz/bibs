import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";
import { stripe } from "@/lib/stripe";

export async function getOrCreateStripeCustomer(
	sellerProfileId: string,
): Promise<string> {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
		with: { user: true },
	});

	if (!profile) {
		throw new ServiceError(404, "Seller profile not found");
	}

	if (profile.stripeCustomerId) {
		return profile.stripeCustomerId;
	}

	const customer = await stripe.customers.create({
		email: profile.user.email,
		name:
			[profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
			undefined,
		metadata: {
			bibs_seller_profile_id: profile.id,
			bibs_user_id: profile.userId,
		},
	});

	await db
		.update(sellerProfile)
		.set({ stripeCustomerId: customer.id })
		.where(eq(sellerProfile.id, sellerProfileId));

	return customer.id;
}
