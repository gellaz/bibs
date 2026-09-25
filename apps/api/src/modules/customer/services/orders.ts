import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerAddress } from "@/db/schemas/address";
import { customerProfile } from "@/db/schemas/customer";
import type {
	OrderStatus,
	OrderType,
	ShippingAddressSnapshot,
} from "@/db/schemas/order";
import { order, orderItem } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { storeProduct } from "@/db/schemas/product";
import { store as storeTable } from "@/db/schemas/store";
import { config } from "@/lib/config";
import { isUniqueViolation, ServiceError } from "@/lib/errors";
import { fromCents, toCents } from "@/lib/money";
import { awardPoints, refundStockAndPoints } from "@/lib/order-helpers";
import { assertTransition } from "@/lib/order-state-machine";
import { parsePagination } from "@/lib/pagination";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import { apportionDiscount, buildCastelletto, scorporo } from "@/lib/vat";
import { getBestActiveDiscount } from "@/modules/seller/services/discount-pricing";

export type OrderTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface ListCustomerOrdersParams {
	customerProfileId: string;
	checkoutId?: string;
	status?: string;
	type?: string;
	page?: number;
	limit?: number;
}

export async function listCustomerOrders(params: ListCustomerOrdersParams) {
	const { customerProfileId, status, type, checkoutId } = params;
	const { page, limit, offset } = parsePagination(params);

	const conditions = [eq(order.customerProfileId, customerProfileId)];
	if (status) conditions.push(eq(order.status, status as OrderStatus));
	if (type) conditions.push(eq(order.type, type as OrderType));
	if (checkoutId) conditions.push(eq(order.checkoutId, checkoutId));

	const where = and(...conditions);

	const [rawData, [{ total }]] = await Promise.all([
		db.query.order.findMany({
			where,
			with: {
				items: { with: { storeProduct: { with: { product: true } } } },
				store: {
					// PostGIS: drizzle non legge la geometria in una relazione annidata.
					columns: { location: false },
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
				// PostGIS: drizzle non legge la geometria in una relazione annidata.
				columns: { location: false },
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

export interface PlaceOrderParams {
	customerProfileId: string;
	customerPoints: number;
	type: "direct" | "reserve_pickup" | "pay_pickup" | "pay_deliver";
	storeId: string;
	items: { storeProductId: string; quantity: number }[];
	shippingAddressId?: string;
	pointsToSpend?: number;
}

export interface CreateOrderParams extends PlaceOrderParams {
	idempotencyKey?: string;
}

/**
 * Crea un ordine dentro una transazione esistente. L'idempotenza è del
 * chiamante: `createOrder` passa la sua key, il checkout nessuna (una key unica
 * su N ordini violerebbe l'indice) e lega gli ordini col `checkoutId`.
 */
export async function placeOrder(
	tx: OrderTx,
	params: PlaceOrderParams,
	link: { idempotencyKey?: string; checkoutId?: string } = {},
) {
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

	// IDOR guard: the shipping address must belong to the ordering customer.
	// The FK alone only proves existence, not ownership. La stessa lettura
	// produce lo snapshot salvato sull'ordine.
	let shippingAddressSnapshot: ShippingAddressSnapshot | null = null;
	if (type === "pay_deliver" && shippingAddressId) {
		const addr = await tx.query.customerAddress.findFirst({
			where: and(
				eq(customerAddress.id, shippingAddressId),
				eq(customerAddress.customerProfileId, customerProfileId),
			),
			with: {
				municipality: {
					columns: { name: true },
					with: { province: { columns: { acronym: true } } },
				},
			},
		});
		if (!addr) throw new ServiceError(404, "Shipping address not found");
		shippingAddressSnapshot = {
			recipientName: addr.recipientName,
			phone: addr.phone,
			addressLine1: addr.addressLine1,
			addressLine2: addr.addressLine2,
			zipCode: addr.zipCode,
			municipalityName: addr.municipality.name,
			provinceAcronym: addr.municipality.province.acronym,
			country: addr.country,
		};
	}

	// Stessa definizione di «vendibile» del carrello: negozio visibile al
	// pubblico, prodotto attivo. Controllato dentro la tx, prima dello stock,
	// così una riga non vendibile annulla l'intero ordine.
	const [sellableStore] = await tx
		.select({ id: storeTable.id })
		.from(storeTable)
		.where(and(eq(storeTable.id, storeId), publiclyVisibleStore()))
		.limit(1);
	if (!sellableStore) throw new ServiceError(404, "Negozio non disponibile");

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
		// Un prodotto non attivo collassa nello stesso 404 del carrello: non si
		// conferma l'esistenza di righe che non si possono comprare.
		if (sp.product.status !== "active")
			throw new ServiceError(404, "Prodotto non disponibile");
		if (sp.stock < item.quantity)
			throw new ServiceError(400, `Insufficient stock for ${sp.product.name}`);

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

	// Points discount (all in cents)
	let discountCents = 0;
	if (pointsToSpend > 0) {
		if (pointsToSpend > customerPoints)
			throw new ServiceError(400, "Insufficient points");
		// Aritmetica intera: (punti / 100) * 100 in virgola mobile perde un
		// centesimo su migliaia di valori (232 punti → 231 centesimi).
		discountCents = Math.floor(
			(pointsToSpend * 100) / config.pointsPerEuroDiscount,
		);
		if (discountCents > totalCents) discountCents = totalCents;
	}
	const actualPointsSpent = Math.floor(
		(discountCents * config.pointsPerEuroDiscount) / 100,
	);
	const finalTotalCents = totalCents - discountCents;

	// Castelletto IVA sul lordo GIÀ scontato dai punti: lo sconto punti è
	// incondizionato, riduce la base imponibile di ogni aliquota in proporzione
	// (resti maggiori, vedi apportionDiscount). Così Σ castelletto == total.
	// order_items.vatAmount resta lo scorporo della riga prima dei punti:
	// l'unica fonte fiscale dell'ordine è vatBreakdown.
	const vatBreakdown = buildCastelletto(
		apportionDiscount(
			resolvedItems.map((it) => ({
				grossCents: toCents(it.unitPrice) * it.quantity,
				rate: Number(it.vatRate),
			})),
			discountCents,
		),
	);

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
			shippingAddressSnapshot,
			shippingCost,
			reservationExpiresAt,
			pointsEarned: 0,
			pointsSpent: actualPointsSpent,
			idempotencyKey: link.idempotencyKey ?? null,
			checkoutId: link.checkoutId ?? null,
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
		// CAS on the live balance inside the tx, mirroring the stock decrement
		// above. The affordability check near the top reads a points snapshot
		// taken OUTSIDE this tx, so without this guard two concurrent checkouts
		// by the same customer could both pass that check and over-spend.
		const [debited] = await tx
			.update(customerProfile)
			.set({
				points: sql`${customerProfile.points} - ${actualPointsSpent}`,
			})
			.where(
				and(
					eq(customerProfile.id, customerProfileId),
					sql`${customerProfile.points} >= ${actualPointsSpent}`,
				),
			)
			.returning();

		if (!debited) throw new ServiceError(409, "Punti insufficienti, riprova");

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
}

export async function createOrder(params: CreateOrderParams) {
	const { idempotencyKey, ...orderParams } = params;

	// Idempotency: return existing order if key was already used
	if (idempotencyKey) {
		const existing = await db.query.order.findFirst({
			where: eq(order.idempotencyKey, idempotencyKey),
		});
		if (existing) return existing;
	}

	// Created eagerly so the idempotency .catch below can be attached
	// synchronously.
	const pendingOrder = db.transaction((tx) =>
		placeOrder(tx, orderParams, { idempotencyKey }),
	);

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

const PICKUP_TYPES: readonly OrderType[] = ["pay_pickup", "reserve_pickup"];
const RESERVATION_EXPIRED = Symbol("reservation-expired");

export async function pickupOrder(params: {
	orderId: string;
	customerProfileId: string;
}) {
	const { orderId, customerProfileId } = params;

	const result = await db.transaction(async (tx) => {
		const existing = await tx.query.order.findFirst({
			where: and(
				eq(order.id, orderId),
				eq(order.customerProfileId, customerProfileId),
			),
			with: { items: true },
		});

		if (!existing) throw new ServiceError(404, "Order not found");

		// Il ritiro è l'unica mossa del cliente: vale solo per ordini da ritirare
		// che il negozio ha segnato pronti. Il resto della macchina a stati
		// (confirmed → completed, shipped → completed) resta del seller.
		if (
			!PICKUP_TYPES.includes(existing.type as OrderType) ||
			existing.status !== "ready_for_pickup"
		)
			throw new ServiceError(400, "L'ordine non è pronto per il ritiro");

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

			// Not a throw: throwing here would roll back the expiry and the
			// refund we just wrote. Commit first, report after.
			return RESERVATION_EXPIRED;
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

	if (result === RESERVATION_EXPIRED)
		throw new ServiceError(400, "Reservation has expired");
	return result;
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
