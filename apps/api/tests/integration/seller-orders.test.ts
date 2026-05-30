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

mock.module("@/lib/s3", () => ({
	s3: { delete: mock(async () => {}) },
}));

import { and, eq } from "drizzle-orm";
import { customerProfile } from "@/db/schemas/customer";
import { order, orderItem } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { storeProduct as storeProductTable } from "@/db/schemas/product";
import { expireSingleReservation } from "@/lib/jobs/expire-reservations";
import { transitionOrder } from "@/modules/seller/services/orders";
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

async function seedReservePickupOrder(
	db: ReturnType<typeof getTestDb>,
	opts: {
		reservationExpiresAt: Date;
		customerPoints?: number;
		pointsSpent?: number;
	},
) {
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	const customer = await createTestCustomer(db, {
		points: opts.customerPoints ?? 100,
	});
	const product = await createTestProduct(db, seller.profile.id);
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 10,
	});

	const [ord] = await db
		.insert(order)
		.values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "reserve_pickup",
			status: "confirmed",
			total: "20.00",
			pointsSpent: opts.pointsSpent ?? 50,
			reservationExpiresAt: opts.reservationExpiresAt,
		})
		.returning();

	await db.insert(orderItem).values({
		orderId: ord.id,
		productName: "Test Product",
		productId: product.id,
		storeProductId: sp.id,
		quantity: 2,
		unitPrice: "10.00",
	});

	return { seller, store, customer, product, sp, order: ord };
}

describe("transitionOrder — reserve_pickup expiry", () => {
	it("rifiuta il completamento di una prenotazione scaduta e fa expire+refund", async () => {
		const db = getTestDb();
		const {
			seller,
			store,
			customer,
			sp,
			order: ord,
		} = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() - 60_000),
			customerPoints: 100,
		});

		await expect(
			transitionOrder(ord.id, seller.profile.id, "completed", [store.id]),
		).rejects.toMatchObject({ status: 400 });

		// Order expired, not completed.
		const fresh = await db.query.order.findFirst({
			where: eq(order.id, ord.id),
		});
		expect(fresh?.status).toBe("expired");
		expect(fresh?.pointsEarned).toBe(0);

		// Stock refunded (10 + 2).
		const stockRow = await db.query.storeProduct.findFirst({
			where: eq(storeProductTable.id, sp.id),
		});
		expect(stockRow?.stock).toBe(12);

		// Spent points refunded (100 + 50).
		const cust = await db.query.customerProfile.findFirst({
			where: eq(customerProfile.id, customer.profile.id),
		});
		expect(cust?.points).toBe(150);

		// No loyalty points were earned; exactly one refund transaction exists.
		const txns = await db.query.pointTransaction.findMany({
			where: eq(pointTransaction.orderId, ord.id),
		});
		expect(txns.filter((t) => t.type === "earned")).toHaveLength(0);
		expect(txns.filter((t) => t.type === "refunded")).toHaveLength(1);
	});

	it("completa normalmente una prenotazione non scaduta", async () => {
		const db = getTestDb();
		const {
			seller,
			store,
			order: ord,
		} = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() + 3_600_000),
			customerPoints: 0,
		});

		const updated = await transitionOrder(
			ord.id,
			seller.profile.id,
			"completed",
			[store.id],
		);

		expect(updated.status).toBe("completed");

		const fresh = await db.query.order.findFirst({
			where: eq(order.id, ord.id),
		});
		expect(fresh?.status).toBe("completed");
	});

	it("non applica l'expiry guard a ordini non-reservation (pay_pickup)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const customer = await createTestCustomer(db, { points: 0 });
		const product = await createTestProduct(db, seller.profile.id);
		const sp = await createTestStoreProduct(db, store.id, product.id, {
			stock: 5,
		});

		const [ord] = await db
			.insert(order)
			.values({
				customerProfileId: customer.profile.id,
				storeId: store.id,
				type: "pay_pickup",
				status: "confirmed",
				total: "15.00",
			})
			.returning();
		await db.insert(orderItem).values({
			orderId: ord.id,
			productName: "Test Product",
			productId: product.id,
			storeProductId: sp.id,
			quantity: 1,
			unitPrice: "15.00",
		});

		const updated = await transitionOrder(
			ord.id,
			seller.profile.id,
			"completed",
			[store.id],
		);
		expect(updated.status).toBe("completed");

		// Stock untouched (no refund path for non-reservation completion).
		const stockRow = await db.query.storeProduct.findFirst({
			where: and(eq(storeProductTable.id, sp.id)),
		});
		expect(stockRow?.stock).toBe(5);
	});

	it("expireSingleReservation è idempotente: una seconda chiamata non re-restocka", async () => {
		// Guards the invariant the compare-and-swap protects: the expire path
		// must restock/refund at most once. (The true concurrent TOCTOU — two
		// expirers interleaving between SELECT and UPDATE — is a production-only
		// race the single-process testcontainer harness serializes away, so this
		// sequential check is the deterministic guard for the same invariant.)
		const db = getTestDb();
		const {
			sp,
			customer,
			order: ord,
		} = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() - 60_000),
			customerPoints: 0,
			pointsSpent: 50,
		});

		const first = await expireSingleReservation(ord.id);
		expect(first).toBe(true);

		const second = await expireSingleReservation(ord.id);
		expect(second).toBe(false);

		// Stock restocked exactly once (10 + 2).
		const stockRow = await db.query.storeProduct.findFirst({
			where: eq(storeProductTable.id, sp.id),
		});
		expect(stockRow?.stock).toBe(12);

		// Points refunded exactly once (0 + 50); a single refunded transaction.
		const cust = await db.query.customerProfile.findFirst({
			where: eq(customerProfile.id, customer.profile.id),
		});
		expect(cust?.points).toBe(50);
		const txns = await db.query.pointTransaction.findMany({
			where: eq(pointTransaction.orderId, ord.id),
		});
		expect(txns.filter((t) => t.type === "refunded")).toHaveLength(1);
	});
});
