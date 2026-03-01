import { count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerProfile } from "@/db/schemas/customer";
import type { OrderStatus, OrderType } from "@/db/schemas/order";
import { order } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { clearExpiry } from "@/lib/jobs/reservation-timer";
import { toCents } from "@/lib/money";
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
		const pointsEarned = Math.floor(
			(toCents(existing.total) / 100) * config.pointsPerEuro,
		);

		const [updated] = await db.transaction(async (tx) => {
			const [upd] = await tx
				.update(order)
				.set({ status: "completed", pointsEarned })
				.where(eq(order.id, orderId))
				.returning();

			if (pointsEarned > 0) {
				await tx
					.update(customerProfile)
					.set({
						points: sql`${customerProfile.points} + ${pointsEarned}`,
					})
					.where(eq(customerProfile.id, existing.customerProfileId));

				await tx.insert(pointTransaction).values({
					customerProfileId: existing.customerProfileId,
					orderId,
					amount: pointsEarned,
					type: "earned",
					description: `Earned ${pointsEarned} points from completed order`,
				});
			}

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
	page?: number;
	limit?: number;
}

export async function listSellerOrders(params: ListSellerOrdersParams) {
	const { storeIds } = params;
	const { page, limit, offset } = parsePagination(params);

	if (storeIds.length === 0)
		return { data: [], pagination: { page, limit, total: 0 } };

	const [data, [{ total }]] = await Promise.all([
		db.query.order.findMany({
			where: inArray(order.storeId, storeIds),
			with: {
				items: { with: { storeProduct: { with: { product: true } } } },
				customerProfile: { with: { user: true } },
				store: true,
			},
			orderBy: (o, { desc }) => [desc(o.createdAt)],
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(order)
			.where(inArray(order.storeId, storeIds)),
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
