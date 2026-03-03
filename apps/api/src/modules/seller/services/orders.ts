import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import type { OrderStatus, OrderType } from "@/db/schemas/order";
import { order } from "@/db/schemas/order";
import { ServiceError } from "@/lib/errors";
import { clearExpiry } from "@/lib/jobs/reservation-timer";
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
		with: { store: true },
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
) {
	const existing = await findSellerOrder(orderId, sellerProfileId);

	assertTransition(
		existing.status as OrderStatus,
		toStatus,
		existing.type as OrderType,
	);

	// Completion requires awarding loyalty points in a transaction
	if (toStatus === "completed") {
		const [updated] = await db.transaction(async (tx) => {
			const pointsEarned = await awardPoints(tx, {
				customerProfileId: existing.customerProfileId,
				orderId,
				totalCents: toCents(existing.total),
			});

			const [upd] = await tx
				.update(order)
				.set({ status: "completed", pointsEarned })
				.where(eq(order.id, orderId))
				.returning();

			return [upd];
		});

		// Clear reservation timer if applicable
		if (existing.type === "reserve_pickup") {
			clearExpiry(orderId);
		}

		return updated;
	}

	const [updated] = await db
		.update(order)
		.set({ status: toStatus })
		.where(eq(order.id, orderId))
		.returning();

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

	const [data, [{ total }]] = await Promise.all([
		db.query.order.findMany({
			where,
			with: {
				items: { with: { storeProduct: { with: { product: true } } } },
				customerProfile: { with: { user: true } },
				store: true,
			},
			orderBy: (o, { desc }) => [desc(o.createdAt)],
			limit,
			offset,
		}),
		db.select({ total: count() }).from(order).where(where),
	]);

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
			store: true,
			shippingAddress: true,
		},
	});

	if (!found || !storeIds.includes(found.storeId))
		throw new ServiceError(404, "Order not found");

	return found;
}
