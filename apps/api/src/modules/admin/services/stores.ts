import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { organization } from "@/db/schemas/organization";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import {
	type StoreSubscriptionStatus,
	storeSubscription,
} from "@/db/schemas/store-subscription";
import { containsPattern } from "@/lib/like";
import { parsePagination } from "@/lib/pagination";
import type { AdminStoreStatus } from "@/lib/schemas/queries";

const alive = isNull(store.deletedAt);
const subIs = (...statuses: StoreSubscriptionStatus[]) =>
	inArray(storeSubscription.status, statuses);

// Una sola definizione per tab, condivisa da lista e conteggi: i numeri delle
// tab non possono divergere dalle righe. Presuppone la LEFT JOIN su
// store_subscription (al più una riga per negozio).
const STATUS_WHERE: Record<AdminStoreStatus, SQL> = {
	all: alive,
	active: sql`${alive} and ${subIs("active", "canceling")}`,
	past_due: sql`${alive} and ${subIs("past_due")}`,
	suspended: sql`${alive} and ${subIs("suspended")}`,
	none: sql`${alive} and (${isNull(storeSubscription.id)} or ${subIs("canceled")})`,
	deleted: isNotNull(store.deletedAt),
};

export interface ListStoresParams {
	page?: number;
	limit?: number;
	status?: AdminStoreStatus;
	search?: string;
	sortBy?: "name" | "createdAt";
	sortOrder?: "asc" | "desc";
}

export async function listStores(params: ListStoresParams) {
	const { page, limit, offset } = parsePagination(params);

	const term = params.search ? containsPattern(params.search) : undefined;
	const where = and(
		STATUS_WHERE[params.status ?? "all"],
		term
			? or(
					ilike(store.name, term),
					ilike(organization.businessName, term),
					ilike(municipality.name, term),
				)
			: undefined,
	);

	const dir = params.sortOrder === "asc" ? asc : desc;
	const sortCol = params.sortBy === "name" ? store.name : store.createdAt;

	// Organization, categoria e abbonamento possono mancare: LEFT JOIN, così il
	// negozio resta in lista con null.
	const [data, [{ total }]] = await Promise.all([
		db
			.select({
				id: store.id,
				name: store.name,
				sellerProfileId: store.sellerProfileId,
				businessName: organization.businessName,
				categoryName: storeCategory.name,
				municipality: {
					name: municipality.name,
					provinceAcronym: province.acronym,
				},
				subscriptionStatus: storeSubscription.status,
				createdAt: store.createdAt,
				deletedAt: store.deletedAt,
			})
			.from(store)
			.innerJoin(municipality, eq(municipality.id, store.municipalityId))
			.innerJoin(province, eq(province.id, municipality.provinceId))
			.leftJoin(
				organization,
				eq(organization.sellerProfileId, store.sellerProfileId),
			)
			.leftJoin(storeCategory, eq(storeCategory.id, store.categoryId))
			.leftJoin(storeSubscription, eq(storeSubscription.storeId, store.id))
			.where(where)
			.orderBy(dir(sortCol), asc(store.id))
			.limit(limit)
			.offset(offset),
		db
			.select({ total: count() })
			.from(store)
			.innerJoin(municipality, eq(municipality.id, store.municipalityId))
			.leftJoin(
				organization,
				eq(organization.sellerProfileId, store.sellerProfileId),
			)
			.leftJoin(storeSubscription, eq(storeSubscription.storeId, store.id))
			.where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

export async function countStoresByStatus(): Promise<
	Record<AdminStoreStatus, number>
> {
	const countWhere = (w: SQL) =>
		sql<number>`count(*) filter (where ${w})`.mapWith(Number);

	const [row] = await db
		.select({
			all: countWhere(STATUS_WHERE.all),
			active: countWhere(STATUS_WHERE.active),
			past_due: countWhere(STATUS_WHERE.past_due),
			suspended: countWhere(STATUS_WHERE.suspended),
			none: countWhere(STATUS_WHERE.none),
			deleted: countWhere(STATUS_WHERE.deleted),
		})
		.from(store)
		.leftJoin(storeSubscription, eq(storeSubscription.storeId, store.id));

	return row;
}
