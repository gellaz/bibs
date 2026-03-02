import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
	storePhoneNumber as storePhoneNumberTable,
	store as storeTable,
} from "@/db/schemas/store";
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
		db.query.store.findMany({
			where,
			limit,
			offset,
			with: { phoneNumbers: true },
		}),
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
	websiteUrl?: string;
	phoneNumbers?: Array<{ label?: string; number: string; position?: number }>;
}

export async function createStore(params: CreateStoreParams) {
	const { phoneNumbers, ...storeData } = params;

	return db.transaction(async (tx) => {
		const [created] = await tx.insert(storeTable).values(storeData).returning();

		if (phoneNumbers && phoneNumbers.length > 0) {
			const phoneValues = phoneNumbers.map((p, idx) => ({
				storeId: created.id,
				label: p.label,
				number: p.number,
				position: p.position ?? idx,
			}));

			await tx.insert(storePhoneNumberTable).values(phoneValues);
		}

		const store = await tx.query.store.findFirst({
			where: eq(storeTable.id, created.id),
			with: { phoneNumbers: true },
		});

		if (!store) throw new ServiceError(500, "Failed to retrieve created store");
		return store;
	});
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
	websiteUrl?: string;
	phoneNumbers?: Array<{ label?: string; number: string; position?: number }>;
}

export async function updateStore(params: UpdateStoreParams) {
	const { storeId, sellerProfileId, phoneNumbers, ...data } = params;

	return db.transaction(async (tx) => {
		const [updated] = await tx
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

		if (phoneNumbers !== undefined) {
			await tx
				.delete(storePhoneNumberTable)
				.where(eq(storePhoneNumberTable.storeId, storeId));

			if (phoneNumbers.length > 0) {
				const phoneValues = phoneNumbers.map((p, idx) => ({
					storeId,
					label: p.label,
					number: p.number,
					position: p.position ?? idx,
				}));

				await tx.insert(storePhoneNumberTable).values(phoneValues);
			}
		}

		const store = await tx.query.store.findFirst({
			where: eq(storeTable.id, storeId),
			with: { phoneNumbers: true },
		});

		if (!store) throw new ServiceError(500, "Failed to retrieve updated store");
		return store;
	});
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
