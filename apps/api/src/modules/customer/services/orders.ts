import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerProfile } from "@/db/schemas/customer";
import type { OrderStatus, OrderType } from "@/db/schemas/order";
import { order, orderItem } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { storeProduct } from "@/db/schemas/product";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { clearExpiry, scheduleExpiry } from "@/lib/jobs/reservation-timer";
import { fromCents, toCents } from "@/lib/money";
import { awardPoints, refundStockAndPoints } from "@/lib/order-helpers";
import { assertTransition } from "@/lib/order-state-machine";
import { parsePagination } from "@/lib/pagination";

interface ListCustomerOrdersParams {
	customerProfileId: string;
	status?: string;
	type?: string;
	page?: number;
	limit?: number;
}

export async function listCustomerOrders(params: ListCustomerOrdersParams) {
	const { customerProfileId, status, type } = params;
	const { page, limit, offset } = parsePagination(params);

	const conditions = [eq(order.customerProfileId, customerProfileId)];
	if (status) conditions.push(eq(order.status, status as OrderStatus));
	if (type) conditions.push(eq(order.type, type as OrderType));

	const where = and(...conditions);

	const [data, [{ total }]] = await Promise.all([
		db.query.order.findMany({
			where,
			with: {
				items: { with: { storeProduct: { with: { product: true } } } },
				store: true,
				shippingAddress: true,
			},
			orderBy: (o, { desc }) => [desc(o.createdAt)],
			limit,
			offset,
		}),
		db.select({ total: count() }).from(order).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

interface GetCustomerOrderParams {
	orderId: string;
	customerProfileId: string;
}

export async function getCustomerOrder(params: GetCustomerOrderParams) {
	const { orderId, customerProfileId } = params;

	const found = await db.query.order.findFirst({
		where: and(
			eq(order.id, orderId),
			eq(order.customerProfileId, customerProfileId),
		),
		with: {
			items: { with: { storeProduct: { with: { product: true } } } },
			store: true,
			shippingAddress: true,
		},
	});

	if (!found) throw new ServiceError(404, "Order not found");
	return found;
}

interface CreateOrderParams {
	customerProfileId: string;
	customerPoints: number;
	type: "direct" | "reserve_pickup" | "pay_pickup" | "pay_deliver";
	storeId: string;
	items: { storeProductId: string; quantity: number }[];
	shippingAddressId?: string;
	pointsToSpend?: number;
}

export async function createOrder(params: CreateOrderParams) {
	const {
		customerProfileId,
		customerPoints,
		type,
		storeId,
		items,
		shippingAddressId,
		pointsToSpend = 0,
	} = params;

	// Shipping cost is determined server-side
	const shippingCost = type === "pay_deliver" ? config.shippingCost : null;

	if (type === "pay_deliver" && !shippingAddressId) {
		throw new ServiceError(
			400,
			"Shipping address is required for delivery orders",
		);
	}

	return db.transaction(async (tx) => {
		// Verify stock availability and calculate total (in cents to avoid float errors)
		let totalCents = 0;
		const resolvedItems: {
			storeProductId: string;
			quantity: number;
			unitPrice: string;
		}[] = [];

		for (const item of items) {
			const sp = await tx.query.storeProduct.findFirst({
				where: and(
					eq(storeProduct.id, item.storeProductId),
					eq(storeProduct.storeId, storeId),
				),
				with: { product: true },
			});

			if (!sp)
				throw new ServiceError(
					404,
					`Store product ${item.storeProductId} not found`,
				);
			if (sp.stock < item.quantity)
				throw new ServiceError(
					400,
					`Insufficient stock for ${sp.product.name}`,
				);

			totalCents += toCents(sp.product.price) * item.quantity;
			resolvedItems.push({
				storeProductId: sp.id,
				quantity: item.quantity,
				unitPrice: sp.product.price,
			});
		}

		// Points discount (all in cents)
		let discountCents = 0;
		if (pointsToSpend > 0) {
			if (pointsToSpend > customerPoints)
				throw new ServiceError(400, "Insufficient points");
			discountCents = Math.floor(
				(pointsToSpend / config.pointsPerEuroDiscount) * 100,
			);
			if (discountCents > totalCents) discountCents = totalCents;
		}
		const actualPointsSpent = Math.floor(
			(discountCents / 100) * config.pointsPerEuroDiscount,
		);
		const finalTotalCents = totalCents - discountCents;

		const initialStatus = type === "direct" ? "completed" : "confirmed";

		const reservationExpiresAt =
			type === "reserve_pickup"
				? new Date(Date.now() + config.reservationHours * 60 * 60 * 1000)
				: null;

		// Create order
		const [newOrder] = await tx
			.insert(order)
			.values({
				customerProfileId,
				storeId,
				type,
				status: initialStatus,
				total: fromCents(finalTotalCents),
				shippingAddressId: type === "pay_deliver" ? shippingAddressId : null,
				shippingCost,
				reservationExpiresAt,
				pointsEarned: 0,
				pointsSpent: actualPointsSpent,
			})
			.returning();

		// Create order items
		await tx.insert(orderItem).values(
			resolvedItems.map((item) => ({
				orderId: newOrder.id,
				storeProductId: item.storeProductId,
				quantity: item.quantity,
				unitPrice: item.unitPrice,
			})),
		);

		// Atomically decrement stock for all order types
		for (const item of resolvedItems) {
			const [updated] = await tx
				.update(storeProduct)
				.set({ stock: sql`${storeProduct.stock} - ${item.quantity}` })
				.where(
					and(
						eq(storeProduct.id, item.storeProductId),
						sql`${storeProduct.stock} >= ${item.quantity}`,
					),
				)
				.returning();

			if (!updated)
				throw new ServiceError(409, "Stock changed during order, please retry");
		}

		// Deduct points spent
		if (actualPointsSpent > 0) {
			await tx
				.update(customerProfile)
				.set({
					points: sql`${customerProfile.points} - ${actualPointsSpent}`,
				})
				.where(eq(customerProfile.id, customerProfileId));

			await tx.insert(pointTransaction).values({
				customerProfileId,
				orderId: newOrder.id,
				amount: -actualPointsSpent,
				type: "redeemed",
				description: `Redeemed ${actualPointsSpent} points for order`,
			});
		}

		// Award points immediately for direct purchase
		if (type === "direct") {
			const pointsEarned = await awardPoints(tx, {
				customerProfileId,
				orderId: newOrder.id,
				totalCents: finalTotalCents,
				description: "Earned points from direct purchase",
			});
			if (pointsEarned > 0) {
				await tx
					.update(order)
					.set({ pointsEarned })
					.where(eq(order.id, newOrder.id));
			}
		}

		// Schedule exact-time expiry for reserve_pickup
		if (type === "reserve_pickup" && reservationExpiresAt) {
			scheduleExpiry(newOrder.id, reservationExpiresAt);
		}

		return newOrder;
	});
}

export async function pickupOrder(params: {
	orderId: string;
	customerProfileId: string;
}) {
	const { orderId, customerProfileId } = params;

	return db.transaction(async (tx) => {
		const existing = await tx.query.order.findFirst({
			where: and(
				eq(order.id, orderId),
				eq(order.customerProfileId, customerProfileId),
			),
			with: { items: true },
		});

		if (!existing) throw new ServiceError(404, "Order not found");

		assertTransition(
			existing.status as OrderStatus,
			"completed",
			existing.type as OrderType,
		);

		// Check reservation expiry — refund points and restock
		if (
			existing.type === "reserve_pickup" &&
			existing.reservationExpiresAt &&
			existing.reservationExpiresAt < new Date()
		) {
			await tx
				.update(order)
				.set({ status: "expired" })
				.where(eq(order.id, existing.id));

			await refundStockAndPoints(tx, existing);

			clearExpiry(existing.id);
			throw new ServiceError(400, "Reservation has expired");
		}

		// Clear the expiry timer — order is being completed
		clearExpiry(existing.id);

		// Award points
		const pointsEarned = await awardPoints(tx, {
			customerProfileId,
			orderId: existing.id,
			totalCents: toCents(existing.total),
			description: "Earned points from order pickup",
		});

		const [updated] = await tx
			.update(order)
			.set({ status: "completed", pointsEarned })
			.where(eq(order.id, existing.id))
			.returning();

		return updated;
	});
}

export async function cancelOrder(params: {
	orderId: string;
	customerProfileId: string;
}) {
	const { orderId, customerProfileId } = params;

	return db.transaction(async (tx) => {
		const existing = await tx.query.order.findFirst({
			where: and(
				eq(order.id, orderId),
				eq(order.customerProfileId, customerProfileId),
			),
			with: { items: true },
		});

		if (!existing) throw new ServiceError(404, "Order not found");

		assertTransition(
			existing.status as OrderStatus,
			"cancelled",
			existing.type as OrderType,
		);

		await refundStockAndPoints(tx, existing);

		// Clear the expiry timer if this was a reserve_pickup
		clearExpiry(existing.id);

		const [updated] = await tx
			.update(order)
			.set({ status: "cancelled" })
			.where(eq(order.id, existing.id))
			.returning();

		return updated;
	});
}
