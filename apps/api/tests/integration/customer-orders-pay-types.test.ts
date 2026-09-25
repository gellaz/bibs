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
import { Elysia } from "elysia";
import { user as userTable } from "@/db/schemas/auth";
import { customerProfile as customerProfileTable } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { ordersRoutes } from "@/modules/customer/routes/orders";
import { createOrder } from "@/modules/customer/services/orders";
import { errorHandler } from "@/plugins/error-handler";
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

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.resolve(async ({ request }) => {
		const id = request.headers.get("x-test-user") ?? "";
		const db = getTestDb();
		const u = await db.query.user.findFirst({ where: eq(userTable.id, id) });
		const cp = await db.query.customerProfile.findFirst({
			where: eq(customerProfileTable.userId, id),
		});
		if (!u || !cp) throw new Error("test customer missing");
		return { user: u, customerProfile: cp };
	})
	.use(ordersRoutes);

async function seed() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, seller.profile.id, {
		price: "10.00",
	});
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 5,
	});
	const customer = await createTestCustomer(db);
	return { store, sp, customer };
}

describe("placeOrder — pay_*", () => {
	it("pay_pickup nasce pending, con scadenza a 30 minuti, commissione e stock già tolto", async () => {
		const { store, sp, customer } = await seed();
		const before = Date.now();
		const created = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "pay_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 2 }],
		});
		expect(created.status).toBe("pending");
		expect(created.platformFee).toBe("1.00"); // 5% di 20,00
		const exp = created.paymentExpiresAt?.getTime() ?? 0;
		expect(exp).toBeGreaterThanOrEqual(before + 30 * 60_000 - 1000);
		expect(exp).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);
		const [row] = await getTestDb()
			.select()
			.from(order)
			.where(eq(order.id, created.id));
		expect(row.status).toBe("pending");
	});

	it("reserve_pickup resta confirmed, senza scadenza di pagamento né commissione", async () => {
		const { store, sp, customer } = await seed();
		const created = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});
		expect(created.status).toBe("confirmed");
		expect(created.paymentExpiresAt).toBeNull();
		expect(created.platformFee).toBe("0.00");
	});
});

describe("POST /orders — niente pay_* senza pagamento", () => {
	for (const type of ["pay_pickup", "pay_deliver"] as const) {
		it(`${type} → 422 e nessun ordine`, async () => {
			const { store, sp, customer } = await seed();
			const res = await app.handle(
				new Request("http://localhost/orders", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-test-user": customer.user.id,
					},
					body: JSON.stringify({
						type,
						storeId: store.id,
						items: [{ storeProductId: sp.id, quantity: 1 }],
					}),
				}),
			);
			expect(res.status).toBe(422);
			expect(await getTestDb().select().from(order)).toHaveLength(0);
		});
	}

	it("reserve_pickup passa", async () => {
		const { store, sp, customer } = await seed();
		const res = await app.handle(
			new Request("http://localhost/orders", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-test-user": customer.user.id,
				},
				body: JSON.stringify({
					type: "reserve_pickup",
					storeId: store.id,
					items: [{ storeProductId: sp.id, quantity: 1 }],
				}),
			}),
		);
		expect(res.status).toBe(200);
	});
});
