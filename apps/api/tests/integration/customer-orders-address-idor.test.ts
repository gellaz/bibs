import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

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

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import { createOrder } from "@/modules/customer/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestCustomerAddress,
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

async function seedDeliveryScenario() {
	const db = getTestDb();
	const buyer = await createTestCustomer(db, { email: "buyer@test.com" });
	const other = await createTestCustomer(db, { email: "other@test.com" });

	const buyerAddress = await createTestCustomerAddress(db, buyer.profile.id);
	const otherAddress = await createTestCustomerAddress(db, other.profile.id);

	const { profile: seller } = await createTestSeller(db);
	const store = await createTestStore(db, seller.id);
	const product = await createTestProduct(db, seller.id, { price: "10.00" });
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 10,
	});

	return { buyer, otherAddress, buyerAddress, store, storeProduct: sp };
}

describe("createOrder — shipping address ownership (IDOR)", () => {
	it("rejects a pay_deliver order pointing at another customer's address", async () => {
		const { buyer, otherAddress, store, storeProduct } =
			await seedDeliveryScenario();

		await expect(
			createOrder({
				customerProfileId: buyer.profile.id,
				customerPoints: 0,
				type: "pay_deliver",
				storeId: store.id,
				items: [{ storeProductId: storeProduct.id, quantity: 1 }],
				shippingAddressId: otherAddress.id,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("accepts a pay_deliver order pointing at the customer's own address", async () => {
		const { buyer, buyerAddress, store, storeProduct } =
			await seedDeliveryScenario();

		const result = await createOrder({
			customerProfileId: buyer.profile.id,
			customerPoints: 0,
			type: "pay_deliver",
			storeId: store.id,
			items: [{ storeProductId: storeProduct.id, quantity: 1 }],
			shippingAddressId: buyerAddress.id,
		});

		expect(result.shippingAddressId).toBe(buyerAddress.id);
	});
});
