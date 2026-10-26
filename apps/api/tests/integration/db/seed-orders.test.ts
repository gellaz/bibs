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
} from "../../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

import { eq } from "drizzle-orm";
import { order } from "@/db/schemas/order";
import { seedOrders } from "@/db/seed/fixtures/orders";
import { seedCustomerEmails } from "@/db/seed/fixtures/utils";
import { truncateAll } from "../../helpers/cleanup";
import {
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
} from "../../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("seedOrders", () => {
	// La tab «Scadute» del seller e lo storico del cliente contano su questa.
	it("lascia una prenotazione scaduta anche con la tolleranza di ritiro", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "seller1@test.com" });
		const store = await createTestStore(db, seller.profile.id);
		await createTestStoreSubscription(db, store.id);
		for (let i = 0; i < 4; i++) {
			const p = await createTestProduct(db, seller.profile.id, {
				price: "10.00",
			});
			await createTestStoreProduct(db, store.id, p.id, { stock: 50 });
		}
		for (const email of seedCustomerEmails(3))
			await createTestCustomer(db, { email });

		await seedOrders();

		const expired = await db.query.order.findMany({
			where: eq(order.status, "expired"),
		});
		expect(expired).toHaveLength(1);
	});
});
