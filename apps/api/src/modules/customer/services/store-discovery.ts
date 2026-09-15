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
import { parsePagination } from "@/lib/pagination";
import { openNowCondition, resolveOpenStatuses } from "@/lib/store-open-status";
import { publiclyVisibleStore } from "@/lib/store-visibility";

interface StoreSearchParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	lat?: number;
	lng?: number;
	radius?: number;
	openNow?: boolean;
	page?: number;
	limit?: number;
}

export interface StoreCard {
	id: string;
	name: string;
	category: { id: string; name: string } | null;
	municipality: { id: string; name: string; provinceAcronym: string };
	addressLine1: string;
	distance: number | null;
	image: { url: string } | null;
	openStatus: OpenStatus;
}

export async function searchStores(params: StoreSearchParams) {
	const { q, categoryId, macroCategoryId, lat, lng, radius, openNow } = params;
	const { page, limit, offset } = parsePagination(params);
	const hasGeo = lat !== undefined && lng !== undefined;

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
	if (hasGeo && radius !== undefined) {
		conditions.push(
			sql`ST_DWithin(
				${store.location}::geography,
				ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
				${radius * 1000}
			)`,
		);
	}
	// In SQL e non come post-filtro sulle righe: filtrare dopo la query darebbe
	// un `total` e una paginazione che non corrispondono ai risultati.
	if (openNow) {
		conditions.push(await openNowCondition(new Date()));
	}

	const whereClause = sql.join(conditions, sql` AND `);

	// Distance: stores.location is on the row directly (no correlated subquery),
	// but in a SELECT-field sql template Drizzle renders interpolated Columns
	// UNqualified, so reference the table literally (`stores.location`).
	const distanceExpr = hasGeo
		? sql`ST_Distance(
				stores.location::geography,
				ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
			)`
		: sql`NULL`;

	const relevanceExpr = q
		? sql`CASE
				WHEN ${store.name} ILIKE ${`${q}%`} THEN 2
				WHEN ${store.name} ILIKE ${`%${q}%`} THEN 1
				ELSE 0
			END`
		: sql`0`;

	// relevance DESC (if q) → distance ASC NULLS LAST (if geo) → name → id.
	const orderParts: ReturnType<typeof sql>[] = [];
	if (q) orderParts.push(sql`relevance DESC`);
	if (hasGeo) orderParts.push(sql`distance ASC NULLS LAST`);
	orderParts.push(sql`${store.name} ASC`);
	orderParts.push(sql`${store.id} ASC`);
	const orderExpr = sql.join(orderParts, sql`, `);

	const [rows, [{ total }]] = await Promise.all([
		db
			.select({
				id: store.id,
				name: store.name,
				addressLine1: store.addressLine1,
				openingHours: store.openingHours,
				closures: store.closures,
				categoryId: store.categoryId,
				categoryName: storeCategory.name,
				municipalityId: municipality.id,
				municipalityName: municipality.name,
				provinceAcronym: province.acronym,
				distance: sql<number | null>`${distanceExpr}`.as("distance"),
				relevance: sql<number>`${relevanceExpr}`.as("relevance"),
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
			.where(whereClause)
			.orderBy(orderExpr)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(store)
			.innerJoin(
				municipality,
				sql`${municipality.id} = ${store.municipalityId}`,
			)
			.where(whereClause),
	]);

	const statusMap = await resolveOpenStatuses(
		rows.map((r) => ({
			id: r.id,
			openingHours: r.openingHours as OpeningHoursDay[] | null,
			closures: r.closures as CustomClosure[] | null,
		})),
		new Date(),
	);

	const data: StoreCard[] = rows.map((r) => ({
		id: r.id,
		name: r.name,
		category:
			r.categoryId && r.categoryName
				? { id: r.categoryId, name: r.categoryName }
				: null,
		municipality: {
			id: r.municipalityId,
			name: r.municipalityName,
			provinceAcronym: r.provinceAcronym,
		},
		addressLine1: r.addressLine1,
		distance: r.distance,
		image: r.imageUrl ? { url: r.imageUrl } : null,
		// statusMap always has the key (resolveOpenStatuses returns one per row);
		// the fallback keeps the type non-optional.
		openStatus: statusMap.get(r.id) ?? { isOpen: false, status: "closed" },
	}));

	return { data, pagination: { page, limit, total } };
}
