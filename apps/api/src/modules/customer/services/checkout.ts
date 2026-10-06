import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cartItem } from "@/db/schemas/cart";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import { product, storeProduct } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { isUniqueViolation, ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { fromCents, toCents } from "@/lib/money";
import { offeredOrderTypes, sellerChargesEnabledSql } from "@/lib/order-types";
import { allocateCheckoutPoints } from "@/lib/points-allocation";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import {
	createCheckoutPaymentIntent,
	payableClientSecret,
	transferStorePayouts,
} from "@/modules/billing/services/order-payments";
import type { OrderTx, PricedOrder } from "./orders";
import { insertOrder, listCustomerOrders, priceOrder } from "./orders";

export interface CheckoutStoreChoice {
	storeId: string;
	type: "reserve_pickup" | "pay_pickup";
}

export interface CreateCheckoutParams {
	customerProfileId: string;
	customerPoints: number;
	idempotencyKey: string;
	stores: CheckoutStoreChoice[];
	usePoints?: boolean;
}

/**
 * Le righe del carrello per i negozi scelti, con gli stessi rifiuti per
 * conferma e anteprima: negozio senza articoli acquistabili (409), modalità
 * non offerta (400), stock insufficiente (409). Con `lock` le righe si
 * bloccano: due conferme concorrenti non leggono le stesse righe.
 */
export async function resolveCheckoutLines(
	tx: OrderTx,
	p: {
		customerProfileId: string;
		stores: CheckoutStoreChoice[];
		lock: boolean;
	},
) {
	const storeIds = p.stores.map((s) => s.storeId);
	if (new Set(storeIds).size !== storeIds.length)
		throw new ServiceError(400, "Ogni negozio può comparire una sola volta");

	const query = tx
		.select({
			id: cartItem.id,
			storeProductId: cartItem.storeProductId,
			quantity: cartItem.quantity,
			stock: storeProduct.stock,
			productStatus: product.status,
			storeId: store.id,
			storeName: store.name,
			orderTypes: store.orderTypes,
			chargesEnabled: sellerChargesEnabledSql,
		})
		.from(cartItem)
		.innerJoin(storeProduct, eq(storeProduct.id, cartItem.storeProductId))
		.innerJoin(product, eq(product.id, storeProduct.productId))
		.innerJoin(store, eq(store.id, storeProduct.storeId))
		.where(
			and(
				eq(cartItem.customerProfileId, p.customerProfileId),
				inArray(store.id, storeIds),
				publiclyVisibleStore(),
			),
		)
		.$dynamic();
	// Due checkout dello stesso cliente (due schede, chiavi diverse) non
	// devono leggere le stesse righe: il secondo aspetta il primo e poi
	// non le trova più → 409, invece di un ordine doppio.
	const lines = p.lock
		? await query.for("update", { of: cartItem })
		: await query;

	return p.stores.map((choice) => {
		const own = lines.filter((l) => l.storeId === choice.storeId);
		const buyable = own.filter((l) => l.productStatus === "active");
		if (buyable.length === 0)
			throw new ServiceError(
				409,
				"Il carrello è cambiato: questo negozio non ha più articoli acquistabili",
			);
		if (
			!offeredOrderTypes(own[0].orderTypes, {
				chargesEnabled: own[0].chargesEnabled,
			}).includes(choice.type)
		)
			throw new ServiceError(
				400,
				`${own[0].storeName} non offre questa modalità d'acquisto`,
			);
		if (buyable.some((l) => l.stock < l.quantity))
			throw new ServiceError(
				409,
				"Il carrello è cambiato: alcune quantità non sono più disponibili",
			);
		return {
			choice,
			buyable: buyable.map((l) => ({
				id: l.id,
				storeProductId: l.storeProductId,
				quantity: l.quantity,
			})),
		};
	});
}

/**
 * Prezza ogni negozio e, se il cliente usa i punti, li ripartisce tra i PR2
 * (allocateCheckoutPoints). Solo letture: la conferma inserisce dopo,
 * l'anteprima si ferma qui.
 */
export async function priceCheckout(
	tx: OrderTx,
	p: {
		customerProfileId: string;
		customerPoints: number;
		usePoints: boolean;
		resolved: Awaited<ReturnType<typeof resolveCheckoutLines>>;
	},
) {
	const priced: PricedOrder[] = [];
	for (const r of p.resolved)
		priced.push(
			await priceOrder(tx, {
				customerProfileId: p.customerProfileId,
				type: r.choice.type,
				storeId: r.choice.storeId,
				items: r.buyable.map((l) => ({
					storeProductId: l.storeProductId,
					quantity: l.quantity,
				})),
			}),
		);

	const payIdx = priced.flatMap((o, i) => (o.type === "pay_pickup" ? [i] : []));
	const allocation = allocateCheckoutPoints({
		balance: p.usePoints ? p.customerPoints : 0,
		grossCents: payIdx.map((i) => priced[i].totalCents),
	});
	const points = priced.map(() => 0);
	const discountCents = priced.map(() => 0);
	payIdx.forEach((i, k) => {
		points[i] = allocation.points[k];
		discountCents[i] = allocation.discountCents[k];
	});

	return p.resolved.map((r, i) => ({
		...r,
		priced: priced[i],
		points: points[i],
		discountCents: discountCents[i],
	}));
}

/** Un checkout con i suoi ordini, nella stessa forma della lista ordini. */
export async function getCheckout(params: {
	checkoutId: string;
	customerProfileId: string;
}) {
	const found = await db.query.checkout.findFirst({
		where: and(
			eq(checkout.id, params.checkoutId),
			eq(checkout.customerProfileId, params.customerProfileId),
		),
	});
	if (!found) throw new ServiceError(404, "Checkout non trovato");
	const { data } = await listCustomerOrders({
		customerProfileId: params.customerProfileId,
		checkoutId: found.id,
		page: 1,
		limit: 100,
	});
	// Il Payment Element serve finché resta un PR2 da pagare; il secret si
	// rilegge da Stripe così refresh e ritorno dal 3DS funzionano.
	const awaitingPayment = data.some(
		(o) => o.type === "pay_pickup" && o.status === "pending",
	);
	const clientSecret =
		awaitingPayment && found.stripePaymentIntentId
			? await payableClientSecret(found.stripePaymentIntentId)
			: null;
	return {
		id: found.id,
		createdAt: found.createdAt,
		amountDueOnline: found.amountDueOnline,
		payment: clientSecret ? { clientSecret } : null,
		orders: data,
	};
}

/**
 * Trasforma il carrello in un ordine per negozio, in UNA transazione: o nascono
 * tutti o nessuno, e nella stessa tx escono dal carrello le righe ordinate.
 * Le righe si leggono dal carrello lato server: il client sceglie solo negozi e
 * tipologia. Righe non disponibili: saltate, restano nel carrello. Stock
 * insufficiente: 409, il cliente torna al carrello. PR2 nasce pending; il
 * PaymentIntent unico copre la somma dei PR2.
 * Con `usePoints` i punti si ripartiscono tra i PR2 (allocateCheckoutPoints);
 * se coprono tutto, i PR2 nascono confermati senza PaymentIntent.
 */
export async function createCheckout(params: CreateCheckoutParams) {
	const {
		customerProfileId,
		customerPoints,
		idempotencyKey,
		stores,
		usePoints = false,
	} = params;

	const existing = await db.query.checkout.findFirst({
		where: eq(checkout.idempotencyKey, idempotencyKey),
	});
	if (existing) {
		if (existing.customerProfileId !== customerProfileId)
			throw new ServiceError(409, "Chiave di idempotenza già usata");
		return getCheckout({ checkoutId: existing.id, customerProfileId });
	}

	const created = db
		.transaction(async (tx) => {
			const [row] = await tx
				.insert(checkout)
				.values({ customerProfileId, idempotencyKey })
				.returning({ id: checkout.id });

			const resolved = await resolveCheckoutLines(tx, {
				customerProfileId,
				stores,
				lock: true,
			});
			const plan = await priceCheckout(tx, {
				customerProfileId,
				customerPoints,
				usePoints,
				resolved,
			});

			let amountDueCents = 0;
			let hasPay = false;
			for (const step of plan) {
				const placed = await insertOrder(tx, step.priced, {
					customerPoints,
					pointsToSpend: step.points,
					link: { checkoutId: row.id },
				});
				if (placed.type === "pay_pickup") {
					hasPay = true;
					amountDueCents += toCents(placed.total);
				}

				const removed = await tx
					.delete(cartItem)
					.where(
						and(
							eq(cartItem.customerProfileId, customerProfileId),
							inArray(
								cartItem.id,
								step.buyable.map((l) => l.id),
							),
						),
					)
					.returning({ id: cartItem.id });
				// Rete di sicurezza del lock: se le righe ordinate non sono più
				// tutte lì, qualcun altro le ha già consumate.
				if (removed.length !== step.buyable.length)
					throw new ServiceError(
						409,
						"Il carrello è cambiato: alcune quantità non sono più disponibili",
					);
			}

			// Un solo pagamento per tutti i negozi PR2 del checkout. Dentro la tx:
			// se Stripe fallisce (502) non nasce nessun ordine e il carrello resta.
			if (amountDueCents > 0) {
				const paymentIntentId = await createCheckoutPaymentIntent({
					checkoutId: row.id,
					customerProfileId,
					amountCents: amountDueCents,
				});
				await tx
					.update(checkout)
					.set({
						stripePaymentIntentId: paymentIntentId,
						amountDueOnline: fromCents(amountDueCents),
					})
					.where(eq(checkout.id, row.id));
			} else if (hasPay) {
				// Tutto coperto dai punti: niente da incassare, niente PaymentIntent.
				// I PR2 si confermano qui, senza finestra di pagamento: il cron
				// delle scadenze guarda solo i pending e non li tocca.
				await tx
					.update(order)
					.set({ status: "confirmed", paymentExpiresAt: null })
					.where(
						and(eq(order.checkoutId, row.id), eq(order.type, "pay_pickup")),
					);
			}

			return { id: row.id, zeroDue: hasPay && amountDueCents === 0 };
		})
		.catch(async (err: unknown) => {
			// Race sulla key: un'altra richiesta identica ha vinto l'insert.
			if (isUniqueViolation(err)) {
				const winner = await db.query.checkout.findFirst({
					where: eq(checkout.idempotencyKey, idempotencyKey),
				});
				if (winner?.customerProfileId === customerProfileId)
					return { id: winner.id, zeroDue: false };
			}
			throw err;
		});

	const { id, zeroDue } = await created;
	// Fuori dalla tx: Stripe non si chiama con le righe ancora non committate.
	// Un fallimento non tocca il cliente (gli ordini sono confermati): la quota
	// punti la ritenta retryStoreTransfers.
	if (zeroDue) {
		try {
			const failed = await transferStorePayouts(id, null);
			if (failed.length > 0)
				logger.error(
					{ checkoutId: id, orderIds: failed },
					"Quota punti al negozio rimasta in sospeso: la ritenta il cron",
				);
		} catch (err) {
			// Mai far fallire la risposta: gli ordini sono già confermati.
			logger.error(
				{ err, checkoutId: id },
				"Trasferimento della quota punti fallito: la ritenta il cron",
			);
		}
	}
	return getCheckout({ checkoutId: id, customerProfileId });
}

const CHECKOUT_TYPES = ["reserve_pickup", "pay_pickup"] as const;

/** `storeId:type,storeId:type` (il formato della scelta nel customer). */
export function parseStoresParam(raw: string): CheckoutStoreChoice[] {
	const stores = raw
		.split(",")
		.filter(Boolean)
		.map((pair) => {
			const [storeId, type] = pair.split(":");
			if (
				!storeId ||
				!CHECKOUT_TYPES.includes(type as CheckoutStoreChoice["type"])
			)
				throw new ServiceError(400, "Scelta dei negozi non valida");
			return { storeId, type: type as CheckoutStoreChoice["type"] };
		});
	if (stores.length === 0)
		throw new ServiceError(400, "Scelta dei negozi non valida");
	return stores;
}

/**
 * Gli importi del checkout prima della conferma, con e senza punti, calcolati
 * dalle stesse funzioni di createCheckout (righe, prezzi, ripartizione): la
 * conferma con `usePoints` produce esattamente `withPoints`. Solo letture.
 */
export async function previewCheckout(p: {
	customerProfileId: string;
	customerPoints: number;
	stores: CheckoutStoreChoice[];
}) {
	// Sola lettura imposta da Postgres: l'anteprima non deve poter scrivere.
	return db.transaction(
		async (tx) => {
			const resolved = await resolveCheckoutLines(tx, {
				customerProfileId: p.customerProfileId,
				stores: p.stores,
				lock: false,
			});
			const plan = await priceCheckout(tx, {
				customerProfileId: p.customerProfileId,
				customerPoints: p.customerPoints,
				usePoints: true,
				resolved,
			});
			const pay = plan.filter((s) => s.priced.type === "pay_pickup");
			const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
			const grossPay = sum(pay.map((s) => s.priced.totalCents));
			const discount = sum(pay.map((s) => s.discountCents));
			return {
				balance: p.customerPoints,
				payInStore: fromCents(
					sum(
						plan
							.filter((s) => s.priced.type === "reserve_pickup")
							.map((s) => s.priced.totalCents),
					),
				),
				withoutPoints: { amountDueOnline: fromCents(grossPay) },
				withPoints:
					discount > 0
						? {
								pointsSpent: sum(pay.map((s) => s.points)),
								discount: fromCents(discount),
								amountDueOnline: fromCents(grossPay - discount),
								perStore: pay.map((s) => ({
									storeId: s.choice.storeId,
									pointsSpent: s.points,
									discount: fromCents(s.discountCents),
								})),
							}
						: null,
			};
		},
		{ accessMode: "read only" },
	);
}
