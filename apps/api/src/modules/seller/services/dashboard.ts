import {
	and,
	asc,
	count,
	eq,
	gt,
	gte,
	isNotNull,
	isNull,
	lt,
	lte,
	min,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "@/db";
import { discount } from "@/db/schemas/discount";
import { type OrderStatus, order } from "@/db/schemas/order";
import { product, storeProduct } from "@/db/schemas/product";
import { store as storeTable } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";

/** Una promozione "in scadenza" finisce entro questa finestra. */
const EXPIRING_WINDOW = sql`interval '3 days'`;

/**
 * Stati che non sono una vendita di oggi: in attesa di pagamento (può ancora
 * scadere da solo), annullato, scaduto. Conteggio e fatturato usano lo stesso
 * insieme, così «N ordini · X €» descrivono gli stessi ordini.
 */
const NOT_A_SALE: OrderStatus[] = ["pending", "cancelled", "expired"];

interface DashboardParams {
	storeId: string;
	/** Istante di riferimento; iniettabile per i test sul bordo di mezzanotte. */
	now?: Date;
}

/**
 * Aggregati della home seller per un negozio. L'accesso al negozio va
 * verificato dal chiamante (`ensureStoreAccess`).
 *
 * «Oggi» è il giorno di calendario a Roma, calcolato in SQL: l'inizio è la
 * mezzanotte locale riportata a timestamptz, la fine la mezzanotte successiva
 * (così i giorni di 23 e 25 ore del cambio d'ora restano giusti).
 */
export async function getSellerDashboard(params: DashboardParams) {
	const now: SQL = sql`${(params.now ?? new Date()).toISOString()}::timestamptz`;
	const romeMidnight = sql`date_trunc('day', ${now} AT TIME ZONE 'Europe/Rome')`;
	const dayStart = sql`(${romeMidnight} AT TIME ZONE 'Europe/Rome')`;
	const dayEnd = sql`((${romeMidnight} + interval '1 day') AT TIME ZONE 'Europe/Rome')`;

	const s = await db.query.store.findFirst({
		where: eq(storeTable.id, params.storeId),
		columns: { sellerProfileId: true, lowStockThreshold: true },
	});
	if (!s) throw new ServiceError(404, "Store not found");
	const threshold = s.lowStockThreshold;

	const activeInStore = and(
		eq(storeProduct.storeId, params.storeId),
		eq(product.sellerProfileId, s.sellerProfileId),
		eq(product.status, "active"),
	);

	const runningPromotion = and(
		eq(discount.sellerProfileId, s.sellerProfileId),
		eq(discount.status, "active"),
		lte(discount.startsAt, now),
		or(isNull(discount.endsAt), gt(discount.endsAt, now)),
	);
	const expiringPromotion = and(
		runningPromotion,
		isNotNull(discount.endsAt),
		lte(discount.endsAt, sql`${now} + ${EXPIRING_WINDOW}`),
	);

	const [
		[today],
		[toPrepare],
		[products],
		outOfStockNames,
		[promotions],
		[firstExpiring],
	] = await Promise.all([
		db
			.select({
				n: count(),
				revenue: sql<string>`coalesce(sum(${order.total}), 0)::numeric(12, 2)::text`,
			})
			.from(order)
			.where(
				and(
					eq(order.storeId, params.storeId),
					gte(order.createdAt, dayStart),
					lt(order.createdAt, dayEnd),
					notInArray(order.status, NOT_A_SALE),
				),
			),
		db
			.select({ n: count(), oldest: min(order.createdAt) })
			.from(order)
			.where(
				and(eq(order.storeId, params.storeId), eq(order.status, "confirmed")),
			),
		// Nei campi SELECT le colonne escono non qualificate: `stock` esiste solo
		// in store_products, quindi non è ambigua.
		db
			.select({
				active: count(),
				outOfStock:
					sql<number>`count(*) filter (where ${storeProduct.stock} = 0)`.mapWith(
						Number,
					),
				lowStock:
					sql<number>`count(*) filter (where ${storeProduct.stock} > 0 and ${storeProduct.stock} < ${threshold})`.mapWith(
						Number,
					),
			})
			.from(storeProduct)
			.innerJoin(product, eq(product.id, storeProduct.productId))
			.where(activeInStore),
		db
			.select({ name: product.name })
			.from(storeProduct)
			.innerJoin(product, eq(product.id, storeProduct.productId))
			.where(and(activeInStore, eq(storeProduct.stock, 0)))
			.orderBy(asc(product.name), asc(product.id))
			.limit(2),
		db
			.select({
				running: count(),
				expiring:
					sql<number>`count(*) filter (where ${expiringPromotion})`.mapWith(
						Number,
					),
			})
			.from(discount)
			.where(runningPromotion),
		db
			.select({ name: discount.title, endsAt: discount.endsAt })
			.from(discount)
			.where(expiringPromotion)
			.orderBy(asc(discount.endsAt), asc(discount.id))
			.limit(1),
	]);

	return {
		stats: {
			ordersToday: today.n,
			revenueToday: today.revenue,
			activeProducts: products.active,
			activePromotions: promotions.running,
		},
		actions: {
			ordersToPrepare: {
				count: toPrepare.n,
				oldestCreatedAt: toPrepare.oldest ?? null,
			},
			outOfStock: {
				count: products.outOfStock,
				sampleNames: outOfStockNames.map((r) => r.name),
			},
			lowStock: { count: products.lowStock, threshold },
			expiringPromotions: {
				count: promotions.expiring,
				first:
					firstExpiring?.endsAt != null
						? { name: firstExpiring.name, endsAt: firstExpiring.endsAt }
						: null,
			},
		},
	};
}
