import { sql } from "drizzle-orm";
import { db } from "@/db";
import { municipality } from "@/db/schemas/location";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { storeMacroCategory } from "@/db/schemas/store-macro-category";
import { publiclyVisibleStore } from "@/lib/store-visibility";

interface StoreFacetParams {
	q?: string;
	lat?: number;
	lng?: number;
	radius?: number;
}

export interface StoreCategoryFacet {
	id: string;
	name: string;
	storeCount: number;
}

export interface StoreMacroFacet {
	id: string;
	name: string;
	storeCount: number;
	categories: StoreCategoryFacet[];
}

export interface StoreFacets {
	/** Stores matching the query regardless of category — the "Tutte" row. */
	total: number;
	macros: StoreMacroFacet[];
}

/**
 * Conteggi per la sidebar di ricerca negozi. I facet rispondono alla domanda
 * "se aggiungo questo filtro, quanti negozi restano?", quindi applicano testo e
 * raggio ma MAI la categoria già selezionata: altrimenti la sidebar mostrerebbe
 * solo il ramo aperto e nasconderebbe le alternative.
 *
 * Le macro a zero non vengono restituite: un filtro che garantisce "nessun
 * risultato" è rumore, non una scelta.
 */
export async function getStoreFacets(
	params: StoreFacetParams,
): Promise<StoreFacets> {
	const { q, lat, lng, radius } = params;
	const hasGeo = lat !== undefined && lng !== undefined;

	const conditions: ReturnType<typeof sql>[] = [publiclyVisibleStore()];

	if (q) {
		conditions.push(
			sql`(${store.name} ILIKE ${`%${q}%`} OR ${municipality.name} ILIKE ${`%${q}%`})`,
		);
	}
	if (hasGeo && radius !== undefined) {
		conditions.push(
			sql`ST_DWithin(
				${store.location}::geography,
				ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
				${radius * 1000}
			)`,
		);
	}

	const whereClause = sql.join(conditions, sql` AND `);

	const [rows, [{ total }]] = await Promise.all([
		db
			.select({
				macroId: storeMacroCategory.id,
				macroName: storeMacroCategory.name,
				categoryId: storeCategory.id,
				categoryName: storeCategory.name,
				storeCount: sql<number>`count(*)::int`,
			})
			.from(store)
			.innerJoin(
				municipality,
				sql`${municipality.id} = ${store.municipalityId}`,
			)
			.innerJoin(storeCategory, sql`${storeCategory.id} = ${store.categoryId}`)
			.innerJoin(
				storeMacroCategory,
				sql`${storeMacroCategory.id} = ${storeCategory.macroCategoryId}`,
			)
			.where(whereClause)
			.groupBy(
				storeMacroCategory.id,
				storeMacroCategory.name,
				storeCategory.id,
				storeCategory.name,
			)
			.orderBy(sql`${storeMacroCategory.name} ASC, ${storeCategory.name} ASC`),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(store)
			.innerJoin(
				municipality,
				sql`${municipality.id} = ${store.municipalityId}`,
			)
			.where(whereClause),
	]);

	const macros = new Map<string, StoreMacroFacet>();
	for (const row of rows) {
		let macro = macros.get(row.macroId);
		if (!macro) {
			macro = {
				id: row.macroId,
				name: row.macroName,
				storeCount: 0,
				categories: [],
			};
			macros.set(row.macroId, macro);
		}
		macro.storeCount += row.storeCount;
		macro.categories.push({
			id: row.categoryId,
			name: row.categoryName,
			storeCount: row.storeCount,
		});
	}

	return { total, macros: Array.from(macros.values()) };
}
