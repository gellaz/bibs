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

import { eq } from "drizzle-orm";
import { orderItem } from "@/db/schemas/order";
import { product as productTable } from "@/db/schemas/product";
import { createOrder } from "@/modules/customer/services/orders";
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
});

describe("createOrder — VAT snapshot + castelletto", () => {
	it("snapshots per-line vatRate/vatAmount and builds the order castelletto", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);

		// Product A: 12.20 € @ 22% → net 10.00, vat 2.20
		const prodA = await createTestProduct(db, seller.profile.id, {
			price: "12.20",
		});
		await db
			.update(productTable)
			.set({ vatRate: "22" })
			.where(eq(productTable.id, prodA.id));
		// Product B: 11.00 € @ 10% → net 10.00, vat 1.00
		const prodB = await createTestProduct(db, seller.profile.id, {
			price: "11.00",
		});
		await db
			.update(productTable)
			.set({ vatRate: "10" })
			.where(eq(productTable.id, prodB.id));

		const spA = await createTestStoreProduct(db, store.id, prodA.id, {
			stock: 5,
		});
		const spB = await createTestStoreProduct(db, store.id, prodB.id, {
			stock: 5,
		});
		const customer = await createTestCustomer(db);

		const newOrder = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [
				{ storeProductId: spA.id, quantity: 1 },
				{ storeProductId: spB.id, quantity: 1 },
			],
		});

		// order.total unchanged: gross sum 12.20 + 11.00
		expect(newOrder.total).toBe("23.20");

		// castelletto: per-rate, sorted rate-desc
		expect(newOrder.vatBreakdown).toEqual([
			{ rate: 22, taxableAmount: "10.00", taxAmount: "2.20" },
			{ rate: 10, taxableAmount: "10.00", taxAmount: "1.00" },
		]);

		const items = await db.query.orderItem.findMany({
			where: eq(orderItem.orderId, newOrder.id),
		});
		const byProduct = new Map(items.map((i) => [i.productId, i]));
		expect(Number(byProduct.get(prodA.id)?.vatRate)).toBe(22);
		expect(byProduct.get(prodA.id)?.vatAmount).toBe("2.20");
		expect(Number(byProduct.get(prodB.id)?.vatRate)).toBe(10);
		expect(byProduct.get(prodB.id)?.vatAmount).toBe("1.00");
	});
});
