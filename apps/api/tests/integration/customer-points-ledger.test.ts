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

import { and, eq, sql } from "drizzle-orm";
import { customerProfile } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { cancelUnpaidOrder } from "@/lib/jobs/expire-unpaid-orders";
import { createOrder } from "@/modules/customer/services/orders";
import { transitionOrder } from "@/modules/seller/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function seed() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, seller.profile.id, {
		price: "10.00",
	});
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 50,
	});
	const customer = await createTestCustomer(db);
	return { seller, store, sp, customer };
}

async function balance(customerProfileId: string) {
	const [cp] = await getTestDb()
		.select({ points: customerProfile.points })
		.from(customerProfile)
		.where(eq(customerProfile.id, customerProfileId));
	return cp.points;
}

/** Σ amount del registro: deve coincidere col saldo, sempre. */
async function ledgerSum(customerProfileId: string) {
	const [row] = await getTestDb()
		.select({
			sum: sql<number>`COALESCE(SUM(${pointTransaction.amount}), 0)::int`,
		})
		.from(pointTransaction)
		.where(eq(pointTransaction.customerProfileId, customerProfileId));
	return row.sum;
}

async function redeemedAmount(orderId: string) {
	const [row] = await getTestDb()
		.select({ amount: pointTransaction.amount })
		.from(pointTransaction)
		.where(
			and(
				eq(pointTransaction.orderId, orderId),
				eq(pointTransaction.type, "redeemed"),
			),
		);
	return row?.amount;
}

describe("point_transactions — Σ amount = saldo", () => {
	it("regge guadagno al ritiro, uso con annullamento e uso con ritiro", async () => {
		const { seller, store, sp, customer } = await seed();
		const cpId = customer.profile.id;
		const pickup = (orderId: string) =>
			transitionOrder(orderId, seller.profile.id, "completed", [store.id]);

		// 10 × 10 € ritirati → +100 punti earned
		const first = await createOrder({
			customerProfileId: cpId,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 10 }],
		});
		await pickup(first.id);
		expect(await balance(cpId)).toBe(100);
		expect(await ledgerSum(cpId)).toBe(100);

		// Usa 100 punti, poi annulla: redeemed −100, refunded +100
		const cancelled = await createOrder({
			customerProfileId: cpId,
			customerPoints: 100,
			type: "pay_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
			pointsToSpend: 100,
		});
		expect(await redeemedAmount(cancelled.id)).toBe(-100);
		expect(await ledgerSum(cpId)).toBe(await balance(cpId));
		// Mai pagato: lo annulla la scadenza dei 30 minuti.
		await cancelUnpaidOrder(cancelled.id);
		expect(await balance(cpId)).toBe(100);
		expect(await ledgerSum(cpId)).toBe(100);

		// Usa 100 punti e ritira: redeemed −100, earned +9 (sui 9 € pagati)
		const picked = await createOrder({
			customerProfileId: cpId,
			customerPoints: 100,
			type: "pay_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
			pointsToSpend: 100,
		});
		expect(await redeemedAmount(picked.id)).toBe(-100);
		// Pagato: lo conferma il webhook del PaymentIntent.
		await getTestDb()
			.update(order)
			.set({ status: "confirmed" })
			.where(eq(order.id, picked.id));
		await pickup(picked.id);
		expect(await balance(cpId)).toBe(9);
		expect(await ledgerSum(cpId)).toBe(9);
	});
});

describe("point_transactions — CHECK di segno per tipo", () => {
	async function insert(
		amount: number,
		type: "earned" | "redeemed" | "refunded",
	) {
		const { customer } = await seed();
		return getTestDb()
			.insert(pointTransaction)
			.values({ customerProfileId: customer.profile.id, amount, type })
			.then(() => "ok");
	}

	it("redeemed positivo viene rifiutato", async () => {
		await expect(insert(5, "redeemed")).rejects.toThrow();
	});

	it("earned e refunded negativi vengono rifiutati", async () => {
		await expect(insert(-5, "earned")).rejects.toThrow();
		await truncateAll(getTestDb());
		await expect(insert(-5, "refunded")).rejects.toThrow();
	});

	it("zero viene rifiutato per ogni tipo", async () => {
		for (const type of ["earned", "redeemed", "refunded"] as const) {
			await truncateAll(getTestDb());
			await expect(insert(0, type)).rejects.toThrow();
		}
	});

	it("i segni giusti passano", async () => {
		expect(await insert(5, "earned")).toBe("ok");
		await truncateAll(getTestDb());
		expect(await insert(-5, "redeemed")).toBe("ok");
		await truncateAll(getTestDb());
		expect(await insert(5, "refunded")).toBe("ok");
	});
});
