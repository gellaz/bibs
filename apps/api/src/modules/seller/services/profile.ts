import { eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/schemas/organization";
import { sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";
import {
	municipalityCompactWith,
	toMunicipalityCompact,
} from "@/lib/municipality";

// ── Helpers ─────────────────────────────────

/**
 * Fetches a seller profile (selected by `where`) with its residence and
 * document municipalities flattened to the compact { id, name, provinceAcronym }
 * shape. Returns null if no row matches. Omits the organization relation.
 */
export async function fetchSellerProfileCompact(where: SQL | undefined) {
	const raw = await db.query.sellerProfile.findFirst({
		where,
		with: {
			residenceMunicipality: municipalityCompactWith,
			documentIssuedMunicipality: municipalityCompactWith,
		},
	});

	if (!raw) return null;

	const { residenceMunicipality, documentIssuedMunicipality, ...rest } = raw;
	return {
		...rest,
		residenceMunicipality: residenceMunicipality
			? toMunicipalityCompact(residenceMunicipality)
			: null,
		documentIssuedMunicipality: documentIssuedMunicipality
			? toMunicipalityCompact(documentIssuedMunicipality)
			: null,
	};
}

// ── Public API ───────────────────────────────

/**
 * Fetches the seller profile for a given user ID.
 * Does not check onboarding status — used for onboarding flow.
 */
export async function getSellerProfile(userId: string) {
	const profile = await fetchSellerProfileCompact(
		eq(sellerProfile.userId, userId),
	);

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
	await db.transaction(async (tx) => {
		await tx
			.update(organization)
			.set({ vatNumber, vatStatus: "pending" })
			.where(eq(organization.sellerProfileId, profile.id));

		await tx
			.update(sellerProfile)
			.set({ onboardingStatus: "pending_review" })
			.where(eq(sellerProfile.userId, userId));
	});

	const updated = await fetchSellerProfileCompact(
		eq(sellerProfile.userId, userId),
	);
	if (!updated) throw new ServiceError(404, "Seller profile not found");
	return updated;
}
