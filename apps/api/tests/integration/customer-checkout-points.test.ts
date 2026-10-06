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
let transferSeq = 0;
const transfersCreate = mock(async (p: any, _o?: any) => ({
	id: `tr_${++transferSeq}`,
	amount: p.amount,
}));
const createReversal = mock(async (_id: string, _p: any, _o?: any) => ({
	id: "trr_1",
}));
const refundsCreate = mock(async (_p: any, _o?: any) => ({ id: "re_1" }));

mock.module("@/lib/stripe", () => ({
	stripe: {
		paymentIntents: {
			create: paymentIntentsCreate,
			retrieve: paymentIntentsRetrieve,
		},
		transfers: { create: transfersCreate, createReversal },
		refunds: { create: refundsCreate },
	},
}));

import { eq } from "drizzle-orm";
import { cartItem } from "@/db/schemas/cart";
import { customerProfile } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { expireUnpaidOrders } from "@/lib/jobs/expire-unpaid-orders";
import {
	createCheckout,
	parseStoresParam,
	previewCheckout,
} from "@/modules/customer/services/checkout";
import { cancelOrder } from "@/modules/customer/services/orders";
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
		createReversal,
		refundsCreate,
	])
		m.mockClear();
	transferSeq = 0;
});

async function sellable(sellerProfileId: string, name: string, price: string) {
	const db = getTestDb();
	const store = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, sellerProfileId, { price });
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 5,
	});
	return { store, sp };
}

/** Due PR2 (20,00 € e 7,50 €) e una prenotazione (4,00 €). */
async function cart(points: number) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const customer = await createTestCustomer(db, { points });
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

const balanceOf = async (customerProfileId: string) =>
	(
		await getTestDb()
			.select({ points: customerProfile.points })
			.from(customerProfile)
			.where(eq(customerProfile.id, customerProfileId))
	)[0].points;

describe("checkout con i punti", () => {
	it("due PR2: punti ripartiti, un PI sul netto, registro scalato", async () => {
		const { customer, pay1, pay2 } = await cart(1000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [
				{ storeId: pay1.store.id, type: "pay_pickup" },
				{ storeId: pay2.store.id, type: "pay_pickup" },
			],
		});

		expect(paymentIntentsCreate).toHaveBeenCalledTimes(1);
		expect(paymentIntentsCreate.mock.calls[0][0].amount).toBe(1750);
		expect(result.amountDueOnline).toBe("17.50");
		const byStore = Object.fromEntries(
			result.orders.map((o) => [o.storeId, o]),
		);
		expect(byStore[pay1.store.id]).toMatchObject({
			total: "12.73",
			pointsSpent: 727,
			status: "pending",
		});
		expect(byStore[pay2.store.id]).toMatchObject({
			total: "4.77",
			pointsSpent: 273,
			status: "pending",
		});
		expect(await balanceOf(customer.profile.id)).toBe(0);
		const ledger = await getTestDb()
			.select()
			.from(pointTransaction)
			.where(eq(pointTransaction.customerProfileId, customer.profile.id));
		expect(ledger.map((l) => l.amount).sort()).toEqual([-273, -727]);
	});

	it("usePoints assente: nessun punto speso", async () => {
		const { customer, pay1 } = await cart(1000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(result.orders[0].pointsSpent).toBe(0);
		expect(await balanceOf(customer.profile.id)).toBe(1000);
	});

	it("usePoints con sole prenotazioni: ignorato, nessun errore", async () => {
		const { customer, reserve } = await cart(1000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [{ storeId: reserve.store.id, type: "reserve_pickup" }],
		});
		expect(result.orders[0]).toMatchObject({ pointsSpent: 0, total: "4.00" });
		expect(await balanceOf(customer.profile.id)).toBe(1000);
	});

	it("misto: la prenotazione non usa punti, il PR2 sì", async () => {
		const { customer, pay2, reserve } = await cart(300);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 300,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [
				{ storeId: pay2.store.id, type: "pay_pickup" },
				{ storeId: reserve.store.id, type: "reserve_pickup" },
			],
		});
		const byStore = Object.fromEntries(
			result.orders.map((o) => [o.storeId, o]),
		);
		expect(byStore[pay2.store.id]).toMatchObject({
			total: "4.50",
			pointsSpent: 300,
		});
		expect(byStore[reserve.store.id]).toMatchObject({
			total: "4.00",
			pointsSpent: 0,
		});
	});

	it("residuo sotto 0,50 €: il PI resta a 0,50 €", async () => {
		const { customer, pay1 } = await cart(1980);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1980,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(paymentIntentsCreate.mock.calls[0][0].amount).toBe(50);
		expect(result.orders[0]).toMatchObject({
			total: "0.50",
			pointsSpent: 1950,
		});
		expect(await balanceOf(customer.profile.id)).toBe(30);
	});

	it("a 0 €: nessun PI, PR2 confermati subito, il cron delle scadenze non li tocca", async () => {
		const { customer, pay1, pay2 } = await cart(5000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 5000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [
				{ storeId: pay1.store.id, type: "pay_pickup" },
				{ storeId: pay2.store.id, type: "pay_pickup" },
			],
		});
		expect(paymentIntentsCreate).not.toHaveBeenCalled();
		expect(result.payment).toBeNull();
		expect(result.amountDueOnline).toBe("0.00");
		for (const o of result.orders) {
			expect(o).toMatchObject({ status: "confirmed", total: "0.00" });
			expect(o.paymentExpiresAt).toBeNull();
		}
		expect(await balanceOf(customer.profile.id)).toBe(2250);

		await expireUnpaidOrders(new Date(Date.now() + 24 * 3600 * 1000));
		const rows = await getTestDb().select().from(order);
		expect(rows.every((o) => o.status === "confirmed")).toBe(true);
	});

	it("saldo sceso dopo la lettura (altra scheda): 409, nessun ordine", async () => {
		const { customer, pay1 } = await cart(0);
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 1000, // foto vecchia
				idempotencyKey: crypto.randomUUID(),
				usePoints: true,
				stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(await getTestDb().select().from(order)).toHaveLength(0);
	});

	it("stessa key con usePoints diverso: restituisce il checkout già creato", async () => {
		const { customer, pay1 } = await cart(1000);
		const key = crypto.randomUUID();
		const first = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: key,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		const again = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: key,
			usePoints: true,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(again.id).toBe(first.id);
		expect(again.orders[0].pointsSpent).toBe(0);
		expect(await balanceOf(customer.profile.id)).toBe(1000);
	});
	it("a 0 €: parte solo la quota punti, dal saldo bibs", async () => {
		const { customer, pay1 } = await cart(5000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 5000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		const o = result.orders[0];
		expect(transfersCreate).toHaveBeenCalledTimes(1);
		const [params, opts] = transfersCreate.mock.calls[0];
		// lordo 20,00 − commissione 1,00 = 19,00, tutto dal saldo bibs
		expect(params.amount).toBe(1900);
		expect(params.source_transaction).toBeUndefined();
		expect(params.transfer_group).toBe(result.id);
		expect(opts).toEqual({ idempotencyKey: `points-transfer:${o.id}` });
		const [row] = await getTestDb()
			.select()
			.from(order)
			.where(eq(order.id, o.id));
		expect(row.stripePointsTransferId).toBe("tr_1");
		expect(row.stripeTransferId).toBeNull();
	});

	it("a 0 € con trasferimento rifiutato: checkout riuscito, quota in sospeso", async () => {
		const { customer, pay1 } = await cart(5000);
		transfersCreate.mockImplementationOnce(async () => {
			throw new Error("insufficient balance");
		});
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 5000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(result.orders[0].status).toBe("confirmed");
		const [row] = await getTestDb()
			.select()
			.from(order)
			.where(eq(order.id, result.orders[0].id));
		expect(row.stripePointsTransferId).toBeNull();
	});

	it("annullare un ordine di un checkout a 0 €: tornano solo i suoi punti", async () => {
		const { customer, pay1, pay2 } = await cart(5000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 5000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [
				{ storeId: pay1.store.id, type: "pay_pickup" },
				{ storeId: pay2.store.id, type: "pay_pickup" },
			],
		});
		expect(await balanceOf(customer.profile.id)).toBe(2250);
		const o2 = result.orders.find((o) => o.storeId === pay2.store.id)!;

		await cancelOrder({
			orderId: o2.id,
			customerProfileId: customer.profile.id,
		});

		expect(await balanceOf(customer.profile.id)).toBe(3000);
		expect(refundsCreate).not.toHaveBeenCalled(); // pagato 0 €
		expect(createReversal).toHaveBeenCalledTimes(1);
		// quota punti di o2: 7,50 − commissione 0,38 = 7,12
		expect(createReversal.mock.calls[0][1].amount).toBe(712);
	});
});

describe("anteprima del checkout", () => {
	it("parità: la preview prevede esattamente gli ordini creati", async () => {
		const { customer, pay1, pay2, reserve } = await cart(1000);
		const stores = [
			{ storeId: pay1.store.id, type: "pay_pickup" as const },
			{ storeId: pay2.store.id, type: "pay_pickup" as const },
			{ storeId: reserve.store.id, type: "reserve_pickup" as const },
		];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			stores,
		});
		expect(preview).toEqual({
			balance: 1000,
			payInStore: "4.00",
			withoutPoints: { amountDueOnline: "27.50" },
			withPoints: {
				pointsSpent: 1000,
				discount: "10.00",
				amountDueOnline: "17.50",
				perStore: [
					{ storeId: pay1.store.id, pointsSpent: 727, discount: "7.27" },
					{ storeId: pay2.store.id, pointsSpent: 273, discount: "2.73" },
				],
			},
		});

		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores,
		});
		expect(created.amountDueOnline).toBe(preview.withPoints!.amountDueOnline);
		for (const s of preview.withPoints!.perStore) {
			const o = created.orders.find((x) => x.storeId === s.storeId)!;
			expect(o.pointsSpent).toBe(s.pointsSpent);
			expect(o.pointsDiscount).toBe(s.discount);
		}
	});

	it("non scrive niente: carrello, stock e saldo intatti", async () => {
		const { customer, pay1 } = await cart(1000);
		await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(await getTestDb().select().from(order)).toHaveLength(0);
		expect(await balanceOf(customer.profile.id)).toBe(1000);
	});

	it("withPoints null senza PR2 o con saldo zero", async () => {
		const a = await cart(1000);
		expect(
			(
				await previewCheckout({
					customerProfileId: a.customer.profile.id,
					customerPoints: 1000,
					stores: [{ storeId: a.reserve.store.id, type: "reserve_pickup" }],
				})
			).withPoints,
		).toBeNull();
		await truncateAll(getTestDb());
		const b = await cart(0);
		expect(
			(
				await previewCheckout({
					customerProfileId: b.customer.profile.id,
					customerPoints: 0,
					stores: [{ storeId: b.pay1.store.id, type: "pay_pickup" }],
				})
			).withPoints,
		).toBeNull();
	});

	it("rifiuta come la conferma: modalità non offerta 400, negozio senza righe 409", async () => {
		const { customer, reserve, pay1 } = await cart(1000);
		await expect(
			previewCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 1000,
				stores: [{ storeId: reserve.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 400 });
		await getTestDb()
			.delete(cartItem)
			.where(eq(cartItem.storeProductId, pay1.sp.id));
		await expect(
			previewCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 1000,
				stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 409 });
	});
});

describe("parseStoresParam", () => {
	it("legge il formato di serializeChoice", () => {
		expect(parseStoresParam("a:pay_pickup,b:reserve_pickup")).toEqual([
			{ storeId: "a", type: "pay_pickup" },
			{ storeId: "b", type: "reserve_pickup" },
		]);
	});
	it("400 su vuoto, tipo sconosciuto o coppia rotta", () => {
		for (const raw of ["", "a:direct", "a", ":pay_pickup"])
			expect(() => parseStoresParam(raw)).toThrow(
				expect.objectContaining({ status: 400 }),
			);
	});
});
