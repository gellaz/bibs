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

let currentEvent: any = null;
const constructEventAsync = mock(async () => currentEvent);
let transferSeq = 0;
const transfersCreate = mock(async (p: any, _o?: any) => ({
	id: `tr_${++transferSeq}`,
	amount: p.amount,
}));
const refundsCreate = mock(async (_p: any, _o?: any) => ({ id: "re_LATE" }));

mock.module("@/lib/stripe", () => ({
	stripe: {
		webhooks: { constructEventAsync },
		transfers: { create: transfersCreate },
		refunds: { create: refundsCreate },
	},
}));
mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		STRIPE_WEBHOOK_SECRET: "whsec_PLATFORM",
	},
}));

import { eq } from "drizzle-orm";
import { checkout } from "@/db/schemas/checkout";
import { order, orderItem } from "@/db/schemas/order";
import { storeProduct } from "@/db/schemas/product";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
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
	transfersCreate.mockClear();
	refundsCreate.mockClear();
	transferSeq = 0;
});

/** Checkout pagato online con due negozi di due seller diversi. */
async function seedPaidCheckout() {
	const db = getTestDb();
	const customer = await createTestCustomer(db);
	const [co] = await db
		.insert(checkout)
		.values({
			customerProfileId: customer.profile.id,
			idempotencyKey: crypto.randomUUID(),
			stripePaymentIntentId: "pi_1",
			amountDueOnline: "30.00",
		})
		.returning();
	const orders = [];
	for (const [i, total, fee] of [
		[1, "10.00", "0.50"],
		[2, "20.00", "1.00"],
	] as const) {
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		await enableOnlinePayments(db, {
			sellerProfileId: seller.profile.id,
			storeId: store.id,
			accountId: `acct_${i}`,
		});
		const product = await createTestProduct(db, seller.profile.id);
		const sp = await createTestStoreProduct(db, store.id, product.id, {
			stock: 4,
		});
		const [o] = await db
			.insert(order)
			.values({
				customerProfileId: customer.profile.id,
				storeId: store.id,
				type: "pay_pickup",
				status: "pending",
				total,
				platformFee: fee,
				checkoutId: co.id,
				paymentExpiresAt: new Date(Date.now() + 60_000),
			})
			.returning();
		await db.insert(orderItem).values({
			orderId: o.id,
			productName: "P",
			productId: product.id,
			storeProductId: sp.id,
			quantity: 1,
			unitPrice: total,
		});
		orders.push({ order: o, sp });
	}
	return { co, orders };
}

function piEvent(
	id: string,
	type: string,
	extra: Record<string, unknown> = {},
) {
	return {
		id,
		type,
		data: {
			object: {
				id: "pi_1",
				object: "payment_intent",
				latest_charge: "ch_1",
				...extra,
			},
		},
	};
}

async function deliver(event: any) {
	currentEvent = event;
	await handleStripeWebhook({ payload: "{}", signature: "sig" });
}

async function reload(id: string) {
	const [r] = await getTestDb().select().from(order).where(eq(order.id, id));
	return r;
}

describe("payment_intent.succeeded", () => {
	it("conferma ogni PR2 del checkout e trasferisce totale − commissione al conto del negozio", async () => {
		const { co, orders } = await seedPaidCheckout();
		await deliver(piEvent("evt_ok", "payment_intent.succeeded"));

		for (const { order: o } of orders)
			expect((await reload(o.id)).status).toBe("confirmed");
		expect(transfersCreate).toHaveBeenCalledTimes(2);
		const calls = transfersCreate.mock.calls.map(([p, opts]) => ({ p, opts }));
		expect(calls).toContainEqual({
			p: expect.objectContaining({
				amount: 950,
				currency: "eur",
				destination: "acct_1",
				source_transaction: "ch_1",
				transfer_group: co.id,
			}),
			opts: { idempotencyKey: `transfer:${orders[0].order.id}` },
		});
		expect(calls).toContainEqual({
			p: expect.objectContaining({ amount: 1900, destination: "acct_2" }),
			opts: { idempotencyKey: `transfer:${orders[1].order.id}` },
		});
		expect((await reload(orders[0].order.id)).stripeTransferId).toMatch(/^tr_/);
	});

	it("evento doppio (stesso id) → un solo trasferimento per ordine", async () => {
		const { orders } = await seedPaidCheckout();
		await deliver(piEvent("evt_dup", "payment_intent.succeeded"));
		await deliver(piEvent("evt_dup", "payment_intent.succeeded"));
		expect(transfersCreate).toHaveBeenCalledTimes(2);
		expect((await reload(orders[1].order.id)).status).toBe("confirmed");
	});

	it("trasferimento fallito → 5xx, alla riconsegna si ritenta solo quello mancante", async () => {
		const { orders } = await seedPaidCheckout();
		transfersCreate.mockImplementationOnce(async () => {
			throw new Error("account disabled");
		});
		await expect(
			deliver(piEvent("evt_retry", "payment_intent.succeeded")),
		).rejects.toThrow();
		// Uno dei due è passato, l'altro no; entrambi confermati.
		const after1 = await Promise.all(orders.map((o) => reload(o.order.id)));
		expect(after1.every((o) => o.status === "confirmed")).toBe(true);
		expect(after1.filter((o) => o.stripeTransferId).length).toBe(1);

		transfersCreate.mockClear();
		await deliver(piEvent("evt_retry", "payment_intent.succeeded"));
		expect(transfersCreate).toHaveBeenCalledTimes(1);
		const after2 = await Promise.all(orders.map((o) => reload(o.order.id)));
		expect(after2.every((o) => o.stripeTransferId)).toBe(true);
	});

	it("un ordine già annullato per scadenza viene rimborsato, non trasferito", async () => {
		const { orders } = await seedPaidCheckout();
		await getTestDb()
			.update(order)
			.set({ status: "cancelled" })
			.where(eq(order.id, orders[0].order.id));

		await deliver(piEvent("evt_late", "payment_intent.succeeded"));

		expect(refundsCreate).toHaveBeenCalledTimes(1);
		expect(refundsCreate.mock.calls[0]).toEqual([
			expect.objectContaining({ payment_intent: "pi_1", amount: 1000 }),
			{ idempotencyKey: `refund:${orders[0].order.id}` },
		]);
		const late = await reload(orders[0].order.id);
		expect(late.status).toBe("cancelled");
		expect(late.stripeRefundId).toBe("re_LATE");
		expect(late.stripeTransferId).toBeNull();
		expect(transfersCreate).toHaveBeenCalledTimes(1); // solo l'altro
	});

	it("PI sconosciuto → ignorato senza errori", async () => {
		await seedPaidCheckout();
		await deliver({
			...piEvent("evt_x", "payment_intent.succeeded"),
			data: { object: { id: "pi_OTHER", latest_charge: "ch_9" } },
		});
		expect(transfersCreate).not.toHaveBeenCalled();
	});
});

describe("payment_intent.payment_failed / canceled", () => {
	it("pagamento rifiutato: gli ordini restano pending (il cliente può riprovare)", async () => {
		const { orders } = await seedPaidCheckout();
		await deliver(piEvent("evt_fail", "payment_intent.payment_failed"));
		for (const { order: o } of orders)
			expect((await reload(o.id)).status).toBe("pending");
	});

	it("PI annullato: PR2 pending → cancelled con restock", async () => {
		const { orders } = await seedPaidCheckout();
		await deliver(piEvent("evt_cancel", "payment_intent.canceled"));
		for (const { order: o, sp } of orders) {
			expect((await reload(o.id)).status).toBe("cancelled");
			const [row] = await getTestDb()
				.select()
				.from(storeProduct)
				.where(eq(storeProduct.id, sp.id));
			expect(row.stock).toBe(5);
		}
	});
});
