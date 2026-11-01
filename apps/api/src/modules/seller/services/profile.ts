import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import {
	municipalityCompactWith,
	toMunicipalityCompact,
} from "@/modules/seller/services/municipality";

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
