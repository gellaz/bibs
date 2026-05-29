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

import { and, eq } from "drizzle-orm";
import { customerProfile } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { transitionOrder } from "@/modules/seller/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestSeller,
	createTestStore,
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

async function insertConfirmedOrder(params: {
	customerProfileId: string;
	storeId: string;
	total?: string;
	pointsSpent?: number;
}) {
	const [o] = await getTestDb()
		.insert(order)
		.values({
			customerProfileId: params.customerProfileId,
			storeId: params.storeId,
			type: "pay_pickup",
			status: "confirmed",
			total: params.total ?? "20.00",
			pointsSpent: params.pointsSpent ?? 0,
		})
		.returning();
	return o;
}

async function countTx(orderId: string, type: "earned" | "refunded") {
	const rows = await getTestDb()
		.select()
		.from(pointTransaction)
		.where(
			and(
				eq(pointTransaction.orderId, orderId),
				eq(pointTransaction.type, type),
			),
		);
	return rows.length;
}

/** Executes a point_transaction insert as a real promise (so expect().rejects works). */
async function insertTx(params: {
	customerProfileId: string;
	orderId: string;
	amount: number;
	type: "earned" | "refunded" | "redeemed";
}) {
	await getTestDb().insert(pointTransaction).values(params);
}

describe("point_transactions — per-order idempotency backstop (unique index)", () => {
	it("rejects a second 'earned' transaction for the same order", async () => {
		const db = getTestDb();
		const { profile: seller } = await createTestSeller(db);
		const store = await createTestStore(db, seller.id);
		const { profile: customer } = await createTestCustomer(db);
		const o = await insertConfirmedOrder({
			customerProfileId: customer.id,
			storeId: store.id,
		});

		await db.insert(pointTransaction).values({
			customerProfileId: customer.id,
			orderId: o.id,
			amount: 20,
			type: "earned",
		});

		await expect(
			insertTx({
				customerProfileId: customer.id,
				orderId: o.id,
				amount: 20,
				type: "earned",
			}),
		).rejects.toBeDefined();
		expect(await countTx(o.id, "earned")).toBe(1);
	});

	it("rejects a second 'refunded' transaction for the same order", async () => {
		const db = getTestDb();
		const { profile: seller } = await createTestSeller(db);
		const store = await createTestStore(db, seller.id);
		const { profile: customer } = await createTestCustomer(db);
		const o = await insertConfirmedOrder({
			customerProfileId: customer.id,
			storeId: store.id,
		});

		await db.insert(pointTransaction).values({
			customerProfileId: customer.id,
			orderId: o.id,
			amount: 10,
			type: "refunded",
		});

		await expect(
			insertTx({
				customerProfileId: customer.id,
				orderId: o.id,
				amount: 10,
				type: "refunded",
			}),
		).rejects.toBeDefined();
		expect(await countTx(o.id, "refunded")).toBe(1);
	});

	it("allows one 'earned' and one 'refunded' for the same order (different types)", async () => {
		const db = getTestDb();
		const { profile: seller } = await createTestSeller(db);
		const store = await createTestStore(db, seller.id);
		const { profile: customer } = await createTestCustomer(db);
		const o = await insertConfirmedOrder({
			customerProfileId: customer.id,
			storeId: store.id,
		});

		await insertTx({
			customerProfileId: customer.id,
			orderId: o.id,
			amount: 20,
			type: "earned",
		});
		await insertTx({
			customerProfileId: customer.id,
			orderId: o.id,
			amount: 10,
			type: "refunded",
		});

		expect(await countTx(o.id, "earned")).toBe(1);
		expect(await countTx(o.id, "refunded")).toBe(1);
	});
});

describe("transitionOrder — completion never double-awards points", () => {
	it("two concurrent completions award loyalty points exactly once", async () => {
		const db = getTestDb();
		const { profile: seller } = await createTestSeller(db);
		const store = await createTestStore(db, seller.id);
		const { profile: customer } = await createTestCustomer(db);
		const o = await insertConfirmedOrder({
			customerProfileId: customer.id,
			storeId: store.id,
			total: "20.00",
		});

		const results = await Promise.allSettled([
			transitionOrder(o.id, seller.id, "completed", [store.id]),
			transitionOrder(o.id, seller.id, "completed", [store.id]),
		]);

		const fulfilled = results.filter((r) => r.status === "fulfilled");
		const rejected = results.filter((r) => r.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);

		expect(await countTx(o.id, "earned")).toBe(1);

		const [cp] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.id));
		expect(cp.points).toBe(20);

		const [updated] = await db.select().from(order).where(eq(order.id, o.id));
		expect(updated.status).toBe("completed");
		expect(updated.pointsEarned).toBe(20);
	});

	it("re-completing an already-completed order does not award again", async () => {
		const db = getTestDb();
		const { profile: seller } = await createTestSeller(db);
		const store = await createTestStore(db, seller.id);
		const { profile: customer } = await createTestCustomer(db);
		const o = await insertConfirmedOrder({
			customerProfileId: customer.id,
			storeId: store.id,
		});

		await transitionOrder(o.id, seller.id, "completed", [store.id]);
		await expect(
			transitionOrder(o.id, seller.id, "completed", [store.id]),
		).rejects.toBeDefined();

		expect(await countTx(o.id, "earned")).toBe(1);
		const [cp] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.id));
		expect(cp.points).toBe(20);
	});
});
