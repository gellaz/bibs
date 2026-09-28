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
const paymentIntentsCreate = mock(async (p: any, _o?: any) => ({
	id: "pi_TEST",
	amount: p.amount,
	client_secret: "pi_TEST_secret_abc",
	status: "requires_payment_method",
}));
const paymentIntentsRetrieve = mock(async (id: string) => ({
	id,
	client_secret: "pi_TEST_secret_abc",
	status: piStatus,
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		paymentIntents: {
			create: paymentIntentsCreate,
			retrieve: paymentIntentsRetrieve,
		},
	},
}));

import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { cartItem } from "@/db/schemas/cart";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import { storeProduct } from "@/db/schemas/product";
import {
	createCheckout,
	getCheckout,
} from "@/modules/customer/services/checkout";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCartItem,
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
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
	paymentIntentsCreate.mockClear();
	paymentIntentsRetrieve.mockClear();
	piStatus = "requires_payment_method";
});

async function sellable(
	sellerProfileId: string,
	name: string,
	price = "10.00",
	stock = 5,
) {
	const db = getTestDb();
	const store = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, sellerProfileId, { price });
	const sp = await createTestStoreProduct(db, store.id, product.id, { stock });
	return { store, sp };
}

async function mixedCart() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const customer = await createTestCustomer(db);
	const pay1 = await sellable(seller.profile.id, "Paga 1", "10.00");
	const pay2 = await sellable(seller.profile.id, "Paga 2", "7.50");
	const reserve = await sellable(seller.profile.id, "Prenota", "4.00");
	for (const s of [pay1, pay2])
		await enableOnlinePayments(db, {
			sellerProfileId: seller.profile.id,
			storeId: s.store.id,
		});
	await createTestCartItem(db, customer.profile.id, pay1.sp.id, {
		quantity: 2,
	});
	await createTestCartItem(db, customer.profile.id, pay2.sp.id, {
		quantity: 1,
	});
	await createTestCartItem(db, customer.profile.id, reserve.sp.id, {
		quantity: 1,
	});
	return { customer, pay1, pay2, reserve };
}

describe("checkout con Paga e ritira", () => {
	it("un solo PaymentIntent per la somma dei PR2, ordini PR2 pending, PP1 confermato", async () => {
		const { customer, pay1, pay2, reserve } = await mixedCart();

		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [
				{ storeId: pay1.store.id, type: "pay_pickup" },
				{ storeId: pay2.store.id, type: "pay_pickup" },
				{ storeId: reserve.store.id, type: "reserve_pickup" },
			],
		});

		expect(paymentIntentsCreate).toHaveBeenCalledTimes(1);
		const [params, opts] = paymentIntentsCreate.mock.calls[0];
		expect(params).toMatchObject({
			amount: 2750, // 2×10,00 + 7,50
			currency: "eur",
			payment_method_types: ["card"],
			transfer_group: result.id,
			metadata: { checkoutId: result.id },
		});
		expect(opts).toEqual({ idempotencyKey: `checkout-pi:${result.id}` });

		expect(result.amountDueOnline).toBe("27.50");
		expect(result.payment).toEqual({ clientSecret: "pi_TEST_secret_abc" });
		const byStore = Object.fromEntries(
			result.orders.map((o) => [o.storeId, o]),
		);
		expect(byStore[pay1.store.id].status).toBe("pending");
		expect(byStore[pay2.store.id].status).toBe("pending");
		expect(byStore[reserve.store.id].status).toBe("confirmed");

		const [co] = await getTestDb()
			.select()
			.from(checkout)
			.where(eq(checkout.id, result.id));
		expect(co.stripePaymentIntentId).toBe("pi_TEST");
		expect(co.amountDueOnline).toBe("27.50");
	});

	it("solo prenotazioni: nessun PaymentIntent, payment null", async () => {
		const { customer, reserve } = await mixedCart();
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: reserve.store.id, type: "reserve_pickup" }],
		});
		expect(paymentIntentsCreate).not.toHaveBeenCalled();
		expect(result.payment).toBeNull();
		expect(result.amountDueOnline).toBe("0.00");
	});

	it("Stripe giù: 502, nessun ordine, carrello e stock intatti", async () => {
		const { customer, pay1 } = await mixedCart();
		paymentIntentsCreate.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeAPIError({
				message: "down",
				type: "api_error",
			} as any);
		});
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 502 });
		const db = getTestDb();
		expect(await db.select().from(order)).toHaveLength(0);
		expect(await db.select().from(checkout)).toHaveLength(0);
		expect(
			await db
				.select()
				.from(cartItem)
				.where(eq(cartItem.customerProfileId, customer.profile.id)),
		).toHaveLength(3);
		const [sp] = await db
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.id, pay1.sp.id));
		expect(sp.stock).toBe(5);
	});

	it("la stessa key restituisce lo stesso checkout senza un secondo PaymentIntent", async () => {
		const { customer, pay1 } = await mixedCart();
		const key = crypto.randomUUID();
		const body = {
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: key,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" as const }],
		};
		const first = await createCheckout(body);
		const second = await createCheckout(body);
		expect(second.id).toBe(first.id);
		expect(second.payment).toEqual({ clientSecret: "pi_TEST_secret_abc" });
		expect(paymentIntentsCreate).toHaveBeenCalledTimes(1);
	});
});

describe("getCheckout — payment", () => {
	it("dopo il pagamento (nessun PR2 pending) payment è null e Stripe non si interroga", async () => {
		const { customer, pay1 } = await mixedCart();
		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		await getTestDb()
			.update(order)
			.set({ status: "confirmed" })
			.where(eq(order.checkoutId, created.id));
		paymentIntentsRetrieve.mockClear();

		const read = await getCheckout({
			checkoutId: created.id,
			customerProfileId: customer.profile.id,
		});
		expect(read.payment).toBeNull();
		expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
	});

	it("PI non più pagabile (succeeded in volo) → payment null anche con ordini pending", async () => {
		const { customer, pay1 } = await mixedCart();
		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		piStatus = "succeeded";
		const read = await getCheckout({
			checkoutId: created.id,
			customerProfileId: customer.profile.id,
		});
		expect(read.payment).toBeNull();
	});

	it("Stripe giù durante il polling → 502, non 'Checkout non trovato'", async () => {
		const { customer, pay1 } = await mixedCart();
		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		paymentIntentsRetrieve.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeAPIError({
				message: "down",
				type: "api_error",
			} as any);
		});
		await expect(
			getCheckout({
				checkoutId: created.id,
				customerProfileId: customer.profile.id,
			}),
		).rejects.toMatchObject({ status: 502 });
	});
});
