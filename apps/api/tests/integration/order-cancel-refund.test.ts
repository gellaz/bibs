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

const refundsCreate = mock(async (_p: any, _o?: any) => ({ id: "re_1" }));
const createReversal = mock(async (_id: string, _p: any, _o?: any) => ({
	id: "trr_1",
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		refunds: { create: refundsCreate },
		transfers: { createReversal },
	},
}));

import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { checkout } from "@/db/schemas/checkout";
import { order, orderItem } from "@/db/schemas/order";
import { storeProduct } from "@/db/schemas/product";
import { cancelOrder } from "@/modules/customer/services/orders";
import { cancelSellerOrder } from "@/modules/seller/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	refundsCreate.mockClear();
	createReversal.mockClear();
});

async function seedPr2(
	status: "pending" | "confirmed",
	transferId: string | null = "tr_1",
) {
	const db = getTestDb();
	const customer = await createTestCustomer(db);
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	const product = await createTestProduct(db, seller.profile.id);
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 1,
	});
	const [co] = await db
		.insert(checkout)
		.values({
			customerProfileId: customer.profile.id,
			idempotencyKey: crypto.randomUUID(),
			stripePaymentIntentId: "pi_1",
			amountDueOnline: "10.00",
		})
		.returning();
	const [o] = await db
		.insert(order)
		.values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "pay_pickup",
			status,
			total: "10.00",
			platformFee: "0.50",
			checkoutId: co.id,
			stripeTransferId: status === "confirmed" ? transferId : null,
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
	return { customer, store, order: o, sp };
}

const reload = async (id: string) =>
	(await getTestDb().select().from(order).where(eq(order.id, id)))[0];

describe("annullamento PR2 confermato", () => {
	it("il negozio annulla: rimborso del totale, storno di totale − commissione, restock", async () => {
		const s = await seedPr2("confirmed");
		await cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] });

		expect(refundsCreate.mock.calls[0]).toEqual([
			expect.objectContaining({ payment_intent: "pi_1", amount: 1000 }),
			{ idempotencyKey: `refund:${s.order.id}` },
		]);
		expect(createReversal.mock.calls[0]).toEqual([
			"tr_1",
			expect.objectContaining({ amount: 950 }),
			{ idempotencyKey: `reversal:${s.order.id}` },
		]);
		const after = await reload(s.order.id);
		expect(after.status).toBe("cancelled");
		expect(after.stripeRefundId).toBe("re_1");
		const [sp] = await getTestDb()
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.id, s.sp.id));
		expect(sp.stock).toBe(2);
	});

	it("il cliente annulla: stesso rimborso", async () => {
		const s = await seedPr2("confirmed");
		await cancelOrder({
			orderId: s.order.id,
			customerProfileId: s.customer.profile.id,
		});
		expect(refundsCreate).toHaveBeenCalledTimes(1);
		expect((await reload(s.order.id)).status).toBe("cancelled");
	});

	it("trasferimento non ancora partito: rimborso senza storno", async () => {
		const s = await seedPr2("confirmed", null);
		await cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] });
		expect(refundsCreate).toHaveBeenCalledTimes(1);
		expect(createReversal).not.toHaveBeenCalled();
	});

	it("storno rifiutato (il seller ha già incassato): il cliente è rimborsato lo stesso", async () => {
		const s = await seedPr2("confirmed");
		createReversal.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeInvalidRequestError({
				message: "insufficient funds",
				type: "invalid_request_error",
			} as any);
		});
		await cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] });
		const after = await reload(s.order.id);
		expect(after.status).toBe("cancelled");
		expect(after.stripeRefundId).toBe("re_1");
	});

	it("rimborso fallito: 502 e l'ordine resta confermato, stock invariato", async () => {
		const s = await seedPr2("confirmed");
		refundsCreate.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeAPIError({
				message: "down",
				type: "api_error",
			} as any);
		});
		await expect(
			cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] }),
		).rejects.toMatchObject({ status: 502 });
		expect((await reload(s.order.id)).status).toBe("confirmed");
		const [sp] = await getTestDb()
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.id, s.sp.id));
		expect(sp.stock).toBe(1);
	});

	it("cliente e negozio annullano insieme: un solo rimborso, il secondo è 409", async () => {
		const s = await seedPr2("confirmed");
		const results = await Promise.allSettled([
			cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] }),
			cancelOrder({
				orderId: s.order.id,
				customerProfileId: s.customer.profile.id,
			}),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(refundsCreate).toHaveBeenCalledTimes(1);
	});
});

describe("annullamento PR2 in attesa di pagamento", () => {
	it("vietato al negozio e al cliente (409), niente rimborsi", async () => {
		const s = await seedPr2("pending");
		await expect(
			cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] }),
		).rejects.toMatchObject({ status: 409 });
		await expect(
			cancelOrder({
				orderId: s.order.id,
				customerProfileId: s.customer.profile.id,
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(refundsCreate).not.toHaveBeenCalled();
		expect((await reload(s.order.id)).status).toBe("pending");
	});
});
