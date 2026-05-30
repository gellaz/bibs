import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import type { OrderStatus, OrderType } from "@/db/schemas/order";
import { order } from "@/db/schemas/order";
import { ServiceError } from "@/lib/errors";
import { expireSingleReservation } from "@/lib/jobs/expire-reservations";
import { toCents } from "@/lib/money";
import { awardPoints } from "@/lib/order-helpers";
import { assertTransition } from "@/lib/order-state-machine";
import { parsePagination } from "@/lib/pagination";

/**
 * Fetches and validates that an order belongs to one of the seller's stores.
 */
export async function findSellerOrder(
	orderId: string,
	sellerProfileId: string,
) {
	const existing = await db.query.order.findFirst({
		where: eq(order.id, orderId),
		with: { store: { columns: { sellerProfileId: true } } },
	});

	if (!existing || existing.store.sellerProfileId !== sellerProfileId)
		throw new ServiceError(404, "Order not found");

	return existing;
}

/**
 * Transitions an order to a new status, validating via the state machine.
 * Handles points awarding on completion.
 */
export async function transitionOrder(
	orderId: string,
	sellerProfileId: string,
	toStatus: OrderStatus,
	accessibleStoreIds: string[],
) {
	const existing = await findSellerOrder(orderId, sellerProfileId);

	// Verify store-level accessibility
	if (!accessibleStoreIds.includes(existing.storeId)) {
		throw new ServiceError(404, "Order not found");
	}

	assertTransition(
		existing.status as OrderStatus,
		toStatus,
		existing.type as OrderType,
	);

	const fromStatus = existing.status as OrderStatus;

	// Completion requires awarding loyalty points in a transaction.
	if (toStatus === "completed") {
		// A reserve_pickup whose reservation window has lapsed must expire
		// (refund stock + spent points), never complete-and-award. Mirrors the
		// customer pickup path; reuses the shared expire helper, which is
		// compare-and-swap guarded so a concurrent expiry can't double-refund.
		if (
			existing.type === "reserve_pickup" &&
			existing.reservationExpiresAt &&
			existing.reservationExpiresAt < new Date()
		) {
			await expireSingleReservation(orderId);
			throw new ServiceError(400, "Reservation has expired");
		}

		const updated = await db.transaction(async (tx) => {
			// Compare-and-swap: only the transaction that still observes the order
			// in its expected status wins. A concurrent completion finds 0 rows and
			// aborts, so points are awarded exactly once.
			const [claimed] = await tx
				.update(order)
				.set({ status: "completed" })
				.where(and(eq(order.id, orderId), eq(order.status, fromStatus)))
				.returning();
			if (!claimed)
				throw new ServiceError(409, "L'ordine è già stato aggiornato");

			const pointsEarned = await awardPoints(tx, {
				customerProfileId: existing.customerProfileId,
				orderId,
				totalCents: toCents(existing.total),
			});

			if (pointsEarned === 0) return claimed;
			const [withPoints] = await tx
				.update(order)
				.set({ pointsEarned })
				.where(eq(order.id, orderId))
				.returning();
			return withPoints;
		});

		return updated;
	}

	const [updated] = await db
		.update(order)
		.set({ status: toStatus })
		.where(and(eq(order.id, orderId), eq(order.status, fromStatus)))
		.returning();
	if (!updated) throw new ServiceError(409, "L'ordine è già stato aggiornato");

	return updated;
}

interface ListSellerOrdersParams {
	storeIds: string[];
	status?: string;
	type?: string;
	page?: number;
	limit?: number;
}

export async function listSellerOrders(params: ListSellerOrdersParams) {
	const { storeIds, status, type } = params;
	const { page, limit, offset } = parsePagination(params);

	if (storeIds.length === 0)
		return { data: [], pagination: { page, limit, total: 0 } };

	const conditions = [inArray(order.storeId, storeIds)];
	if (status) conditions.push(eq(order.status, status as OrderStatus));
	if (type) conditions.push(eq(order.type, type as OrderType));

	const where = and(...conditions);

	const [rawData, [{ total }]] = await Promise.all([
		db.query.order.findMany({
			where,
			with: {
				items: { with: { storeProduct: { with: { product: true } } } },
				customerProfile: { with: { user: true } },
				store: {
					with: {
						municipality: {
							columns: { id: true, name: true },
							with: { province: { columns: { acronym: true } } },
						},
					},
				},
			},
			orderBy: (o, { desc }) => [desc(o.createdAt)],
			limit,
			offset,
		}),
		db.select({ total: count() }).from(order).where(where),
	]);

	const data = rawData.map(({ store, ...rest }) => ({
		...rest,
		store: {
			...store,
			municipality: {
				id: store.municipality.id,
				name: store.municipality.name,
				provinceAcronym: store.municipality.province.acronym,
			},
		},
	}));

	return { data, pagination: { page, limit, total } };
}

interface GetSellerOrderParams {
	orderId: string;
	storeIds: string[];
}

export async function getSellerOrder(params: GetSellerOrderParams) {
	const { orderId, storeIds } = params;

	const found = await db.query.order.findFirst({
		where: eq(order.id, orderId),
		with: {
			items: { with: { storeProduct: { with: { product: true } } } },
			customerProfile: { with: { user: true } },
			store: {
				with: {
					municipality: {
						columns: { id: true, name: true },
						with: { province: { columns: { acronym: true } } },
					},
				},
			},
			shippingAddress: true,
		},
	});

	if (!found || !storeIds.includes(found.storeId))
		throw new ServiceError(404, "Order not found");

	const { store, ...foundRest } = found;
	return {
		...foundRest,
		store: {
			...store,
			municipality: {
				id: store.municipality.id,
				name: store.municipality.name,
				provinceAcronym: store.municipality.province.acronym,
			},
		},
	};
}
