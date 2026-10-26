import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { geocodingLookup } from "@/db/schemas/geocoding";
import type { GeocodeHit, GeocodingProviderName } from "./provider";

/** Un indirizzo non si sposta: trenta giorni sono prudenti, non aggressivi. */
export const LOOKUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedLookup {
	hits: GeocodeHit[];
	/** Oltre il TTL: da rinfrescare, e usabile solo se il provider non risponde. */
	isStale: boolean;
}

interface LookupKey {
	provider: GeocodingProviderName;
	query: string;
	biasCell: string;
}

export async function readLookup(
	key: LookupKey,
	now = Date.now(),
): Promise<CachedLookup | null> {
	const row = await db.query.geocodingLookup.findFirst({
		where: and(
			eq(geocodingLookup.provider, key.provider),
			eq(geocodingLookup.query, key.query),
			eq(geocodingLookup.biasCell, key.biasCell),
		),
	});
	if (!row) return null;

	return {
		hits: row.results,
		isStale: now - row.fetchedAt.getTime() > LOOKUP_TTL_MS,
	};
}

export async function writeLookup(
	params: LookupKey & { hits: GeocodeHit[] },
): Promise<void> {
	const now = new Date();
	await db
		.insert(geocodingLookup)
		.values({
			provider: params.provider,
			query: params.query,
			biasCell: params.biasCell,
			results: params.hits,
			fetchedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				geocodingLookup.provider,
				geocodingLookup.query,
				geocodingLookup.biasCell,
			],
			set: { results: params.hits, fetchedAt: now },
		});
}
