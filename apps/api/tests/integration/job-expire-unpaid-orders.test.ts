import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

let piStatus = "requires_payment_method";
const paymentIntentsRetrieve = mock(async (id: string) => ({
	id,
	status: piStatus,
	latest_charge: "ch_1",
}));
const paymentIntentsCancel = mock(async (id: string) => ({
	id,
	status: "canceled",
}));
const transfersCreate = mock(async (p: any) => ({
	id: "tr_1",
	amount: p.amount,
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		paymentIntents: {
			retrieve: paymentIntentsRetrieve,
			cancel: paymentIntentsCancel,
		},
		transfers: { create: transfersCreate },
		refunds: { create: mock(async () => ({ id: "re_1" })) },
	},
}));

import { eq } from "drizzle-orm";
import { checkout } from "@/db/schemas/checkout";
import { order, orderItem } from "@/db/schemas/order";
import { storeProduct } from "@/db/schemas/product";
import { expireUnpaidOrders } from "@/lib/jobs/expire-unpaid-orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	enableOnlinePayments,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	piStatus = "requires_payment_method";
	paymentIntentsRetrieve.mockClear();
	paymentIntentsCancel.mockClear();
	transfersCreate.mockClear();
});

async function seedPending(expiresInMs: number, withPi = true) {
	const db = getTestDb();
	const customer = await createTestCustomer(db);
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	await enableOnlinePayments(db, {
		sellerProfileId: seller.profile.id,
		storeId: store.id,
	});
	const product = await createTestProduct(db, seller.profile.id);
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 2,
	});
	const [co] = await db
		.insert(checkout)
		.values({
			customerProfileId: customer.profile.id,
			idempotencyKey: crypto.randomUUID(),
			stripePaymentIntentId: withPi ? `pi_${crypto.randomUUID()}` : null,
			amountDueOnline: "10.00",
		})
		.returning();
	const [o] = await db
		.insert(order)
		.values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "pay_pickup",
			status: "pending",
			total: "10.00",
			platformFee: "0.50",
			checkoutId: co.id,
			paymentExpiresAt: new Date(Date.now() + expiresInMs),
		})
		.returning();
	await db.insert(orderItem).values({
		orderId: o.id,
		productName: "P",
		productId: product.id,
		storeProductId: sp.id,
		quantity: 1,
		unitPrice: "10.00",
	});
	return { order: o, sp, co };
}

const statusOf = async (id: string) =>
	(await getTestDb().select().from(order).where(eq(order.id, id)))[0].status;
const stockOf = async (id: string) =>
	(
		await getTestDb().select().from(storeProduct).where(eq(storeProduct.id, id))
	)[0].stock;

describe("expireUnpaidOrders", () => {
	it("scaduto e non pagato: annulla il PI, poi l'ordine, e restituisce lo stock", async () => {
		const s = await seedPending(-1000);
		expect(await expireUnpaidOrders()).toBe(1);
		expect(paymentIntentsCancel).toHaveBeenCalledWith(
			s.co.stripePaymentIntentId,
		);
		expect(await statusOf(s.order.id)).toBe("cancelled");
		expect(await stockOf(s.sp.id)).toBe(3);
	});

	it("non ancora scaduto: nessuna azione", async () => {
		const s = await seedPending(60_000);
		expect(await expireUnpaidOrders()).toBe(0);
		expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
		expect(await statusOf(s.order.id)).toBe("pending");
	});

	it("PI riuscito all'ultimo secondo: conferma e trasferisce invece di annullare", async () => {
		const s = await seedPending(-1000);
		piStatus = "succeeded";
		expect(await expireUnpaidOrders()).toBe(0);
		expect(paymentIntentsCancel).not.toHaveBeenCalled();
		expect(await statusOf(s.order.id)).toBe("confirmed");
		expect(transfersCreate).toHaveBeenCalledTimes(1);
	});

	it("PI in elaborazione: aspetta il prossimo giro", async () => {
		const s = await seedPending(-1000);
		piStatus = "processing";
		expect(await expireUnpaidOrders()).toBe(0);
		expect(await statusOf(s.order.id)).toBe("pending");
	});

	it("annullamento del PI rifiutato da Stripe: l'ordine resta pending, gli altri checkout proseguono", async () => {
		const a = await seedPending(-1000);
		const b = await seedPending(-1000);
		paymentIntentsCancel.mockImplementationOnce(async () => {
			throw new Error("stripe down");
		});
		expect(await expireUnpaidOrders()).toBe(1);
		const statuses = [
			await statusOf(a.order.id),
			await statusOf(b.order.id),
		].sort();
		expect(statuses).toEqual(["cancelled", "pending"]);
	});

	it("pay_* senza PaymentIntent (dati storici): annullato direttamente", async () => {
		const s = await seedPending(-1000, false);
		expect(await expireUnpaidOrders()).toBe(1);
		expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
		expect(await statusOf(s.order.id)).toBe("cancelled");
	});
});
