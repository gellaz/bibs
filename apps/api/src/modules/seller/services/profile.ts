import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";

/**
 * Fetches the seller profile for a given user ID.
 * Does not check VAT status — used for onboarding flow.
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

interface UpdateVatParams {
	userId: string;
	vatNumber: string;
}

/**
 * Updates the VAT number for a rejected seller.
 * Resets status to pending.
 */
export async function updateSellerVat(params: UpdateVatParams) {
	const { userId, vatNumber } = params;

	// First, check the current profile
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) {
		throw new ServiceError(404, "Seller profile not found");
	}

	// Only allow updates if status is rejected
	if (profile.vatStatus !== "rejected") {
		throw new ServiceError(
			400,
			"VAT number can only be updated when status is rejected",
		);
	}

	// Update the VAT number and reset status to pending
	const [updated] = await db
		.update(sellerProfile)
		.set({ vatNumber, vatStatus: "pending" })
		.where(eq(sellerProfile.userId, userId))
		.returning();

	return updated;
}
