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

const paymentIntentsCreate = mock(async (p: any, _o?: any) => ({
	id: "pi_TEST",
	amount: p.amount,
	client_secret: "pi_TEST_secret_abc",
	status: "requires_payment_method",
}));
const paymentIntentsRetrieve = mock(async (id: string) => ({
	id,
	client_secret: "pi_TEST_secret_abc",
	status: "requires_payment_method",
}));
const transfersCreate = mock(async (p: any, _o?: any) => ({
	id: "tr_1",
	amount: p.amount,
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		paymentIntents: {
			create: paymentIntentsCreate,
			retrieve: paymentIntentsRetrieve,
		},
		transfers: { create: transfersCreate },
	},
}));

import { eq } from "drizzle-orm";
import { cartItem } from "@/db/schemas/cart";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import {
	createCheckout,
	previewCheckout,
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
	for (const m of [
		paymentIntentsCreate,
		paymentIntentsRetrieve,
		transfersCreate,
	])
		m.mockClear();
});

/** Un negozio con un prodotto a `price`, pagamenti online attivi. */
async function sellable(sellerProfileId: string, name: string, price: string) {
	const db = getTestDb();
	const store = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, sellerProfileId, { price });
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 5,
	});
	await enableOnlinePayments(db, { sellerProfileId, storeId: store.id });
	return { store, sp };
}

/** Due negozi da 0,30 € (prodotti a 0,30, qty 1), un terzo da 4,00 €. */
async function cart(points: number) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const customer = await createTestCustomer(db, { points });
	const a = await sellable(seller.profile.id, "Piccolo A", "0.30");
	const b = await sellable(seller.profile.id, "Piccolo B", "0.30");
	const big = await sellable(seller.profile.id, "Grande", "4.00");
	for (const s of [a, b, big])
		await createTestCartItem(db, customer.profile.id, s.sp.id, {
			quantity: 1,
		});
	return { customer, a, b, big };
}

const ordersCount = async () =>
	(await getTestDb().select({ id: order.id }).from(order)).length;
const checkoutsCount = async () =>
	(await getTestDb().select({ id: checkout.id }).from(checkout)).length;
const cartCount = async (customerProfileId: string) =>
	(
		await getTestDb()
			.select({ id: cartItem.id })
			.from(cartItem)
			.where(eq(cartItem.customerProfileId, customerProfileId))
	).length;

describe("Paga e ritira sotto 0,50 €", () => {
	it("1. un PR2 da 0,30 €: anteprima belowMinimum, conferma 400, niente creato", async () => {
		const { customer, a } = await cart(0);
		const stores = [{ storeId: a.store.id, type: "pay_pickup" as const }];

		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			stores,
		});
		expect(preview).toMatchObject({
			minAmountOnline: "0.50",
			withoutPoints: { amountDueOnline: "0.30", belowMinimum: true },
			withPoints: null,
		});

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores,
			}),
		).rejects.toMatchObject({
			status: 400,
			message:
				"Il pagamento online parte da 0,50 €: scegli «Prenota e paga in negozio» o aggiungi articoli",
		});
		expect(paymentIntentsCreate).not.toHaveBeenCalled();
		expect(await ordersCount()).toBe(0);
		expect(await checkoutsCount()).toBe(0);
		expect(await cartCount(customer.profile.id)).toBe(3);
	});

	it("2. due PR2 da 0,30 €: la somma 0,60 € si paga", async () => {
		const { customer, a, b } = await cart(0);
		const stores = [
			{ storeId: a.store.id, type: "pay_pickup" as const },
			{ storeId: b.store.id, type: "pay_pickup" as const },
		];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			stores,
		});
		expect(preview.withoutPoints).toEqual({
			amountDueOnline: "0.60",
			belowMinimum: false,
		});
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores,
		});
		expect(paymentIntentsCreate.mock.calls[0][0].amount).toBe(60);
		expect(result.amountDueOnline).toBe("0.60");
	});

	it("3. PR2 0,30 € + prenotazione 4,00 €: la prenotazione non conta, 400", async () => {
		const { customer, a, big } = await cart(0);
		const stores = [
			{ storeId: a.store.id, type: "pay_pickup" as const },
			{ storeId: big.store.id, type: "reserve_pickup" as const },
		];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			stores,
		});
		expect(preview.withoutPoints.belowMinimum).toBe(true);
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("4. PR2 0,30 € con punti che azzerano: 0 €, confermato, nessun PI", async () => {
		const { customer, a } = await cart(100);
		const stores = [{ storeId: a.store.id, type: "pay_pickup" as const }];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 100,
			stores,
		});
		expect(preview.withoutPoints.belowMinimum).toBe(true);
		expect(preview.withPoints).toMatchObject({
			pointsSpent: 30,
			amountDueOnline: "0.00",
		});
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 100,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores,
		});
		expect(paymentIntentsCreate).not.toHaveBeenCalled();
		expect(result.orders[0]).toMatchObject({
			status: "confirmed",
			pointsSpent: 30,
		});
	});

	it("5. stesso carrello senza usePoints: 400", async () => {
		const { customer, a } = await cart(100);
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 100,
				idempotencyKey: crypto.randomUUID(),
				stores: [{ storeId: a.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("6. saldo insufficiente con usePoints: nessuno sconto, 400", async () => {
		const { customer, a } = await cart(10);
		const stores = [{ storeId: a.store.id, type: "pay_pickup" as const }];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 10,
			stores,
		});
		expect(preview.withPoints).toBeNull();
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 10,
				idempotencyKey: crypto.randomUUID(),
				usePoints: true,
				stores,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("7. esattamente 0,50 €: si paga", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db, { points: 0 });
		const s = await sellable(seller.profile.id, "Soglia", "0.50");
		await createTestCartItem(db, customer.profile.id, s.sp.id, {
			quantity: 1,
		});
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: s.store.id, type: "pay_pickup" }],
		});
		expect(paymentIntentsCreate.mock.calls[0][0].amount).toBe(50);
		expect(result.amountDueOnline).toBe("0.50");
	});
});
