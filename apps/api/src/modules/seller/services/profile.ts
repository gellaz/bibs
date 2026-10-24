import { eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
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
		throw new ServiceError(404, "Profilo venditore non trovato");
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
		throw new ServiceError(404, "Profilo venditore non trovato");
	}

	return profile;
}
