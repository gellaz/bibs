import { sql } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { storeImage } from "@/db/schemas/store-image";
import type {
	CustomClosure,
	OpeningHoursDay,
	OpenStatus,
} from "@/lib/holidays";
import { openNowCondition, resolveOpenStatuses } from "@/lib/store-open-status";
import type { StoreFilterParams } from "./store-search-conditions";
import { storeFilterConditions } from "./store-search-conditions";

/**
 * Tetto di sicurezza ai pin di una singola risposta. Il clustering regge la
 * densità visiva; questo protegge il payload. Oltre il tetto la UI lo dichiara
 * invece di mostrare in silenzio una mappa parziale.
 */
export const MAP_PIN_CAP = 500;

export interface StoreMapParams extends StoreFilterParams {
	openNow?: boolean;
}

export interface StoreMapPin {
	id: string;
	name: string;
	coordinates: { lat: number; lng: number };
	category: { id: string; name: string } | null;
	municipality: { id: string; name: string; provinceAcronym: string };
	distance: number | null;
	image: { url: string } | null;
	openStatus: OpenStatus;
}

export interface StoreMapResult {
	pins: StoreMapPin[];
	/** Negozi che corrispondono ai filtri, mappabili o no. */
	total: number;
	/** Quanti di quelli hanno una posizione. */
	mappable: number;
	truncated: boolean;
}

/**
 * I pin della vista mappa: gli stessi negozi che la lista mostrerebbe, tutti in
 * una risposta invece che a pagine — su una mappa i risultati non si scorrono.
 *
 * `cap` è iniettabile solo per i test: in produzione resta `MAP_PIN_CAP`.
 */
export async function getStoreMapPins(
	params: StoreMapParams,
	cap: number = MAP_PIN_CAP,
): Promise<StoreMapResult> {
	const { lat, lng, openNow } = params;
	const hasGeo = lat !== undefined && lng !== undefined;

	const conditions = storeFilterConditions(params);
	if (openNow) {
		conditions.push(await openNowCondition(new Date()));
	}

	const whereClause = sql.join(conditions, sql` AND `);
	// I pin richiedono una posizione; `total` no. La differenza fra i due è
	// esattamente ciò che la UI dichiara all'utente.
	const mappableClause = sql.join(
		[...conditions, sql`stores.location IS NOT NULL`],
		sql` AND `,
	);

	// In a SELECT-field sql template Drizzle renders interpolated Columns
	// UNqualified, so reference the table literally (`stores.location`).
	const distanceExpr = hasGeo
		? sql`ST_Distance(
				stores.location::geography,
				ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
			)`
		: sql`NULL`;

	// Nessun NULLS LAST: il WHERE dei pin ha già escluso chi non ha posizione.
	const orderExpr = hasGeo
		? sql`distance ASC, ${store.name} ASC, ${store.id} ASC`
		: sql`${store.name} ASC, ${store.id} ASC`;

	const countStores = (where: ReturnType<typeof sql>) =>
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(store)
			.innerJoin(
				municipality,
				sql`${municipality.id} = ${store.municipalityId}`,
			)
			.where(where);

	const [rows, [{ total }], [{ total: mappable }]] = await Promise.all([
		db
			.select({
				id: store.id,
				name: store.name,
				location: store.location,
				openingHours: store.openingHours,
				closures: store.closures,
				categoryId: store.categoryId,
				categoryName: storeCategory.name,
				municipalityId: municipality.id,
				municipalityName: municipality.name,
				provinceAcronym: province.acronym,
				distance: sql<number | null>`${distanceExpr}`.as("distance"),
				imageUrl: sql<string | null>`(
					SELECT si.url FROM ${storeImage} si
					WHERE si.store_id = stores.id
					ORDER BY si.position ASC
					LIMIT 1
				)`.as("image_url"),
			})
			.from(store)
			.innerJoin(
				municipality,
				sql`${municipality.id} = ${store.municipalityId}`,
			)
			.innerJoin(province, sql`${province.id} = ${municipality.provinceId}`)
			.leftJoin(storeCategory, sql`${storeCategory.id} = ${store.categoryId}`)
			.where(mappableClause)
			.orderBy(orderExpr)
			.limit(cap),
		countStores(whereClause),
		countStores(mappableClause),
	]);

	const statusMap = await resolveOpenStatuses(
		rows.map((r) => ({
			id: r.id,
			openingHours: r.openingHours as OpeningHoursDay[] | null,
			closures: r.closures as CustomClosure[] | null,
		})),
		new Date(),
	);

	const pins: StoreMapPin[] = rows.flatMap((r) => {
		// Il WHERE lo garantisce già: questo restringe il tipo, non i dati.
		if (!r.location) return [];
		return [
			{
				id: r.id,
				name: r.name,
				coordinates: { lat: r.location.y, lng: r.location.x },
				category:
					r.categoryId && r.categoryName
						? { id: r.categoryId, name: r.categoryName }
						: null,
				municipality: {
					id: r.municipalityId,
					name: r.municipalityName,
					provinceAcronym: r.provinceAcronym,
				},
				distance: r.distance,
				image: r.imageUrl ? { url: r.imageUrl } : null,
				openStatus: statusMap.get(r.id) ?? { isOpen: false, status: "unknown" },
			},
		];
	});

	return { pins, total, mappable, truncated: mappable > cap };
}
