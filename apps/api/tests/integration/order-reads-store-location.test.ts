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

import { Value } from "@sinclair/typebox/value";
import {
	CustomerOrderWithRelationsSchema,
	SellerOrderWithRelationsSchema,
} from "@/lib/schemas";
import {
	createOrder,
	getCustomerOrder,
	listCustomerOrders,
} from "@/modules/customer/services/orders";
import {
	getSellerOrder,
	listSellerOrders,
} from "@/modules/seller/services/orders";
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

// Le letture degli ordini caricano il negozio come relazione annidata. Drizzle
// non sa leggere la geometria PostGIS (`stores.location`) dentro una query
// relazionale annidata e lancia RangeError: la colonna va esclusa.
async function seedOrderOnLocatedStore() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id, {
		lng: 11.3426,
		lat: 44.4949,
	});
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, seller.profile.id);
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 5,
	});
	const customer = await createTestCustomer(db);
	const created = await createOrder({
		customerProfileId: customer.profile.id,
		customerPoints: 0,
		type: "reserve_pickup",
		storeId: store.id,
		items: [{ storeProductId: sp.id, quantity: 1 }],
	});
	return { store, customer, created };
}

describe("letture ordini su un negozio con coordinate", () => {
	it("listSellerOrders e getSellerOrder rispettano lo schema", async () => {
		const { store, created } = await seedOrderOnLocatedStore();

		const { data } = await listSellerOrders({
			storeIds: [store.id],
			page: 1,
			limit: 20,
		});
		expect(data).toHaveLength(1);
		expect(Value.Check(SellerOrderWithRelationsSchema, data[0])).toBe(true);

		const detail = await getSellerOrder({
			orderId: created.id,
			storeIds: [store.id],
		});
		expect(Value.Check(SellerOrderWithRelationsSchema, detail)).toBe(true);
	});

	it("listCustomerOrders e getCustomerOrder rispettano lo schema", async () => {
		const { customer, created } = await seedOrderOnLocatedStore();

		const { data } = await listCustomerOrders({
			customerProfileId: customer.profile.id,
			page: 1,
			limit: 20,
		});
		expect(data).toHaveLength(1);
		expect(Value.Check(CustomerOrderWithRelationsSchema, data[0])).toBe(true);

		const detail = await getCustomerOrder({
			orderId: created.id,
			customerProfileId: customer.profile.id,
		});
		expect(Value.Check(CustomerOrderWithRelationsSchema, detail)).toBe(true);
	});
});
