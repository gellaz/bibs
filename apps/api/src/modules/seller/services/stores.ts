import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { store as storeTable } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface ListStoresParams {
	sellerProfileId: string;
	page?: number;
	limit?: number;
}

export async function listStores(params: ListStoresParams) {
	const { sellerProfileId } = params;
	const { page, limit, offset } = parsePagination(params);

	const where = and(
		eq(storeTable.sellerProfileId, sellerProfileId),
		isNull(storeTable.deletedAt),
	);

	const [data, [{ total }]] = await Promise.all([
		db.query.store.findMany({ where, limit, offset }),
		db.select({ total: count() }).from(storeTable).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

interface CreateStoreParams {
	sellerProfileId: string;
	name: string;
	description?: string;
	addressLine1: string;
	addressLine2?: string;
	city: string;
	zipCode: string;
	province?: string;
	country?: string;
	location?: { x: number; y: number };
}

export async function createStore(params: CreateStoreParams) {
	const [created] = await db.insert(storeTable).values(params).returning();

	return created;
}

interface UpdateStoreParams {
	storeId: string;
	sellerProfileId: string;
	name?: string;
	description?: string;
	addressLine1?: string;
	addressLine2?: string;
	city?: string;
	zipCode?: string;
	province?: string;
	country?: string;
	location?: { x: number; y: number };
}

export async function updateStore(params: UpdateStoreParams) {
	const { storeId, sellerProfileId, ...data } = params;

	const [updated] = await db
		.update(storeTable)
		.set(data)
		.where(
			and(
				eq(storeTable.id, storeId),
				eq(storeTable.sellerProfileId, sellerProfileId),
				isNull(storeTable.deletedAt),
			),
		)
		.returning();

	if (!updated) throw new ServiceError(404, "Store not found");
	return updated;
}

interface DeleteStoreParams {
	storeId: string;
	sellerProfileId: string;
}

export async function deleteStore(params: DeleteStoreParams) {
	const { storeId, sellerProfileId } = params;

	const [deleted] = await db
		.update(storeTable)
		.set({ deletedAt: new Date() })
		.where(
			and(
				eq(storeTable.id, storeId),
				eq(storeTable.sellerProfileId, sellerProfileId),
				isNull(storeTable.deletedAt),
			),
		)
		.returning();

	if (!deleted) throw new ServiceError(404, "Store not found");
	return deleted;
}
