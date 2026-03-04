import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/schemas/organization";
import { sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";

/**
 * Fetches the seller profile for a given user ID.
 * Does not check onboarding status — used for onboarding flow.
 */
export async function getSellerProfile(userId: string) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) {
		throw new ServiceError(404, "Seller profile not found");
	}

	return profile;
}

/**
 * Fetches the seller profile with organization for a given user ID.
 */
export async function getSellerProfileWithOrg(userId: string) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
		with: { organization: true },
	});

	if (!profile) {
		throw new ServiceError(404, "Seller profile not found");
	}

	return profile;
}

interface UpdateVatParams {
	userId: string;
	vatNumber: string;
}

/**
 * Updates the VAT number for a rejected seller.
 * Resets organization vatStatus to pending.
 */
export async function updateSellerVat(params: UpdateVatParams) {
	const { userId, vatNumber } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) {
		throw new ServiceError(404, "Seller profile not found");
	}

	if (profile.onboardingStatus !== "rejected") {
		throw new ServiceError(
			400,
			"VAT number can only be updated when onboarding is rejected",
		);
	}

	// Update organization VAT and reset statuses
	const [updated] = await db.transaction(async (tx) => {
		await tx
			.update(organization)
			.set({ vatNumber, vatStatus: "pending" })
			.where(eq(organization.sellerProfileId, profile.id));

		return tx
			.update(sellerProfile)
			.set({ onboardingStatus: "pending_review" })
			.where(eq(sellerProfile.userId, userId))
			.returning();
	});

	return updated;
}
