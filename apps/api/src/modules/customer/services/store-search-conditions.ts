import { sql } from "drizzle-orm";
import { municipality } from "@/db/schemas/location";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { publiclyVisibleStore } from "@/lib/store-visibility";

export interface StoreFilterParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	lat?: number;
	lng?: number;
	/** Raggio in km. Applicato solo se ci sono anche lat/lng. */
	radius?: number;
}

/**
 * Condizioni WHERE condivise da ricerca negozi, facet e mappa: le tre viste
 * rispondono alla stessa domanda ("quali negozi corrispondono a questi
 * filtri?"), e tre copie dello stesso array erano tre occasioni di divergere.
 *
 * `openNow` resta fuori di proposito: i facet hanno bisogno della condizione
 * come pezzo separato per contare quanti negozi *sarebbero* aperti a filtro
 * spento, quindi ogni chiamante compone `openNowCondition()` come gli serve —
 * e questo helper resta sincrono.
 *
 * Richiede il join su `municipality` (la ricerca testuale guarda anche il nome
 * del comune): ogni chiamante lo ha già.
 */
export function storeFilterConditions({
	q,
	categoryId,
	macroCategoryId,
	lat,
	lng,
	radius,
}: StoreFilterParams): ReturnType<typeof sql>[] {
	const conditions: ReturnType<typeof sql>[] = [publiclyVisibleStore()];

	if (q) {
		conditions.push(
			sql`(${store.name} ILIKE ${`%${q}%`} OR ${municipality.name} ILIKE ${`%${q}%`})`,
		);
	}
	// `categoryId` wins over `macroCategoryId`: a leaf already sits inside its
	// macro, so applying both would only ever narrow to the same set.
	if (categoryId) {
		conditions.push(sql`${store.categoryId} = ${categoryId}`);
	} else if (macroCategoryId) {
		conditions.push(
			sql`EXISTS (
				SELECT 1 FROM ${storeCategory} sc
				WHERE sc.id = stores.category_id
					AND sc.macro_category_id = ${macroCategoryId}
			)`,
		);
	}
	if (lat !== undefined && lng !== undefined && radius !== undefined) {
		conditions.push(
			sql`ST_DWithin(
				${store.location}::geography,
				ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
				${radius * 1000}
			)`,
		);
	}

	return conditions;
}
