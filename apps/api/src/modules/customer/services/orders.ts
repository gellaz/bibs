import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerAddress } from "@/db/schemas/address";
import { customerProfile } from "@/db/schemas/customer";
import type { OrderStatus, OrderType } from "@/db/schemas/order";
import { order, orderItem } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { storeProduct } from "@/db/schemas/product";
import { config } from "@/lib/config";
import { isUniqueViolation, ServiceError } from "@/lib/errors";
import { fromCents, toCents } from "@/lib/money";
import { awardPoints, refundStockAndPoints } from "@/lib/order-helpers";
import { assertTransition } from "@/lib/order-state-machine";
import { parsePagination } from "@/lib/pagination";
import { buildCastelletto, scorporo } from "@/lib/vat";
import { getBestActiveDiscount } from "@/modules/seller/services/discount-pricing";

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

	const [rawData, [{ total }]] = await Promise.all([
		db.query.order.findMany({
			where,
			with: {
				items: { with: { storeProduct: { with: { product: true } } } },
				store: {
					with: {
						municipality: {
							columns: { id: true, name: true },
							with: { province: { columns: { acronym: true } } },
						},
					},
				},
				shippingAddress: {
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

	const data = rawData.map(({ store, shippingAddress, ...rest }) => ({
		...rest,
		store: {
			...store,
			municipality: {
				id: store.municipality.id,
				name: store.municipality.name,
				provinceAcronym: store.municipality.province.acronym,
			},
		},
		shippingAddress: shippingAddress
			? (() => {
					const { municipality, ...addrRest } = shippingAddress;
					return {
						...addrRest,
						municipality: {
							id: municipality.id,
							name: municipality.name,
							provinceAcronym: municipality.province.acronym,
						},
					};
				})()
			: null,
	}));

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
			store: {
				with: {
					municipality: {
						columns: { id: true, name: true },
						with: { province: { columns: { acronym: true } } },
					},
				},
			},
			shippingAddress: {
				with: {
					municipality: {
						columns: { id: true, name: true },
						with: { province: { columns: { acronym: true } } },
					},
				},
			},
		},
	});

	if (!found) throw new ServiceError(404, "Order not found");
	const { store, shippingAddress, ...foundRest } = found;
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
		shippingAddress: shippingAddress
			? (() => {
					const { municipality, ...addrRest } = shippingAddress;
					return {
						...addrRest,
						municipality: {
							id: municipality.id,
							name: municipality.name,
							provinceAcronym: municipality.province.acronym,
						},
					};
				})()
			: null,
	};
}

interface CreateOrderParams {
	customerProfileId: string;
	customerPoints: number;
	type: "direct" | "reserve_pickup" | "pay_pickup" | "pay_deliver";
	storeId: string;
	items: { storeProductId: string; quantity: number }[];
	shippingAddressId?: string;
	pointsToSpend?: number;
	idempotencyKey?: string;
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
		idempotencyKey,
	} = params;

	// Idempotency: return existing order if key was already used
	if (idempotencyKey) {
		const existing = await db.query.order.findFirst({
			where: eq(order.idempotencyKey, idempotencyKey),
		});
		if (existing) return existing;
	}

	// Shipping cost is determined server-side
	const shippingCost = type === "pay_deliver" ? config.shippingCost : null;

	if (type === "pay_deliver" && !shippingAddressId) {
		throw new ServiceError(
			400,
			"Shipping address is required for delivery orders",
		);
	}

	// IDOR guard: the shipping address must belong to the ordering customer.
	// The FK alone only proves existence, not ownership.
	if (type === "pay_deliver" && shippingAddressId) {
		const [addr] = await db
			.select({ id: customerAddress.id })
			.from(customerAddress)
			.where(
				and(
					eq(customerAddress.id, shippingAddressId),
					eq(customerAddress.customerProfileId, customerProfileId),
				),
			)
			.limit(1);
		if (!addr) throw new ServiceError(404, "Shipping address not found");
	}

	// Created eagerly so the idempotency .catch below can be attached
	// synchronously (no reindent of the transaction body).
	const pendingOrder = db.transaction(async (tx) => {
		// Verify stock availability and calculate total (in cents to avoid float errors)
		let totalCents = 0;
		const resolvedItems: {
			storeProductId: string;
			productId: string;
			productName: string;
			productEan: string | null;
			brandName: string | null;
			productImageUrl: string | null;
			quantity: number;
			unitPrice: string;
			listPrice: string;
			discountPercent: number | null;
			vatRate: string;
			vatAmount: string;
		}[] = [];

		for (const item of items) {
			const sp = await tx.query.storeProduct.findFirst({
				where: and(
					eq(storeProduct.id, item.storeProductId),
					eq(storeProduct.storeId, storeId),
				),
				with: {
					product: {
						with: {
							brand: true,
							images: {
								orderBy: (img, { asc }) => [asc(img.position)],
								limit: 1,
							},
						},
					},
				},
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

			// Sconto venditore: prezzo unitario scontato PRIMA dello sconto punti,
			// con lo stesso rounding del prezzo mostrato al cliente
			// (ROUND(price * (1 - percent/100), 2) per unità, half-away-from-zero).
			// Semantica last-word: se la promo viene messa in pausa/archiviata tra
			// display e checkout, si paga il listino. Lookup per-riga DENTRO la tx
			// (N+1 deliberato: carrelli piccoli, consistenza transazionale con le
			// letture di stock/prezzo; per batch esiste getBestActiveDiscounts).
			const discountInfo = await getBestActiveDiscount(sp.product.id, tx);
			const listUnitCents = toCents(sp.product.price);
			const unitCents = discountInfo
				? Math.round((listUnitCents * (100 - discountInfo.percent)) / 100)
				: listUnitCents;

			const lineGrossCents = unitCents * item.quantity;
			totalCents += lineGrossCents;
			const { vatCents } = scorporo(lineGrossCents, Number(sp.product.vatRate));
			resolvedItems.push({
				storeProductId: sp.id,
				productId: sp.product.id,
				productName: sp.product.name,
				productEan: sp.product.ean ?? null,
				brandName: sp.product.brand?.name ?? null,
				productImageUrl: sp.product.images[0]?.url ?? null,
				quantity: item.quantity,
				unitPrice: fromCents(unitCents),
				listPrice: sp.product.price,
				discountPercent: discountInfo?.percent ?? null,
				vatRate: sp.product.vatRate,
				vatAmount: fromCents(vatCents),
			});
		}

		// Castelletto IVA: scorporo per-aliquota sui lordi di riga (PRIMA dello
		// sconto punti — l'apportionment dello sconto punti tra aliquote è demandato
		// al futuro layer di fatturazione).
		const vatBreakdown = buildCastelletto(
			resolvedItems.map((it) => ({
				grossCents: toCents(it.unitPrice) * it.quantity,
				rate: Number(it.vatRate),
			})),
		);

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
				idempotencyKey: idempotencyKey ?? null,
				vatBreakdown,
			})
			.returning();

		// Create order items with product snapshot for historical integrity
		await tx.insert(orderItem).values(
			resolvedItems.map((item) => ({
				orderId: newOrder.id,
				storeProductId: item.storeProductId,
				productId: item.productId,
				productName: item.productName,
				productEan: item.productEan,
				brandName: item.brandName,
				productImageUrl: item.productImageUrl,
				quantity: item.quantity,
				unitPrice: item.unitPrice,
				listPrice: item.listPrice,
				discountPercent: item.discountPercent,
				vatRate: item.vatRate,
				vatAmount: item.vatAmount,
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
				amount: actualPointsSpent,
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
				const [updated] = await tx
					.update(order)
					.set({ pointsEarned })
					.where(eq(order.id, newOrder.id))
					.returning();
				return updated;
			}
		}

		return newOrder;
	});

	return pendingOrder.catch(async (err: unknown) => {
		// Idempotency race: a concurrent caller inserted the same idempotencyKey
		// between our pre-tx findFirst above and this transaction's INSERT, so the
		// order_idempotency_key_idx unique index rejected our duplicate. Honor the
		// idempotency contract by returning the order that won the race instead of
		// surfacing a generic 409. Any other error (or a missing row) is rethrown.
		if (idempotencyKey && isUniqueViolation(err)) {
			const existing = await db.query.order.findFirst({
				where: eq(order.idempotencyKey, idempotencyKey),
			});
			if (existing) return existing;
		}
		throw err;
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
			// Compare-and-swap so a concurrent expirer (cron sweep / seller
			// completion) can't double-refund: only refund if we claim the flip.
			const [claimed] = await tx
				.update(order)
				.set({ status: "expired" })
				.where(
					and(eq(order.id, existing.id), eq(order.status, existing.status)),
				)
				.returning();

			if (claimed) {
				await refundStockAndPoints(tx, existing);
			}

			throw new ServiceError(400, "Reservation has expired");
		}

		// Compare-and-swap: claim the completion before awarding points, so two
		// concurrent pickups can't both award loyalty points.
		const [claimed] = await tx
			.update(order)
			.set({ status: "completed" })
			.where(and(eq(order.id, existing.id), eq(order.status, existing.status)))
			.returning();
		if (!claimed)
			throw new ServiceError(409, "L'ordine è già stato aggiornato");

		const pointsEarned = await awardPoints(tx, {
			customerProfileId,
			orderId: existing.id,
			totalCents: toCents(existing.total),
			description: "Earned points from order pickup",
		});

		if (pointsEarned === 0) return claimed;
		const [updated] = await tx
			.update(order)
			.set({ pointsEarned })
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

		// Compare-and-swap before refunding, so two concurrent cancels can't both
		// refund the spent points.
		const [updated] = await tx
			.update(order)
			.set({ status: "cancelled" })
			.where(and(eq(order.id, existing.id), eq(order.status, existing.status)))
			.returning();
		if (!updated)
			throw new ServiceError(409, "L'ordine è già stato aggiornato");

		await refundStockAndPoints(tx, existing);

		return updated;
	});
}
