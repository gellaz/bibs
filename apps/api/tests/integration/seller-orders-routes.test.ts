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
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { order } from "@/db/schemas/order";
import { resolveSellerAccess } from "@/modules/seller/context";
import { ordersRoutes } from "@/modules/seller/routes/orders";
import { errorHandler } from "@/plugins/error-handler";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestSeller,
	createTestStore,
} from "../helpers/fixtures";

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

// Stessa resolve della guardia seller vera (`resolveSellerAccess`), con
// l'utente preso da un header al posto della sessione better-auth.
const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.resolve(async ({ request }) => {
		const id = request.headers.get("x-test-user") ?? "";
		const u = await getTestDb().query.user.findFirst({
			where: eq(userTable.id, id),
		});
		if (!u) throw new Error("test user missing");
		return { user: u, ...(await resolveSellerAccess(u)) };
	})
	.use(ordersRoutes);

function call(userId: string, method: string, path: string, body?: unknown) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method,
			headers: {
				"x-test-user": userId,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

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
	const owner = await createTestSeller(db);
	const assigned = await createTestStore(db, owner.profile.id);
	const other = await createTestStore(db, owner.profile.id);
	const stranger = await createTestSeller(db);
	const customer = await createTestCustomer(db);

	// Employee assegnato solo al primo negozio.
	const empUserId = crypto.randomUUID();
	await db.insert(userTable).values({
		id: empUserId,
		name: "Employee",
		email: `emp-${empUserId.slice(0, 8)}@test.com`,
		emailVerified: true,
		role: "employee",
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	const [emp] = await db
		.insert(storeEmployee)
		.values({
			sellerProfileId: owner.profile.id,
			userId: empUserId,
			status: "active",
		})
		.returning();
	await db
		.insert(storeEmployeeStores)
		.values({ storeEmployeeId: emp.id, storeId: assigned.id });

	const [orderOnOther] = await db
		.insert(order)
		.values({
			customerProfileId: customer.profile.id,
			storeId: other.id,
			type: "reserve_pickup",
			status: "confirmed",
			total: "10.00",
		})
		.returning();

	return { owner, stranger, empUserId, assigned, other, orderOnOther };
}

describe("GET /orders/counts", () => {
	it("owner → 200 con tutti gli stati", async () => {
		const { owner, other } = await seed();
		const res = await call(
			owner.user.id,
			"GET",
			`/orders/counts?storeId=${other.id}`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Object.keys(body.data).sort()).toEqual(
			[
				"cancelled",
				"completed",
				"confirmed",
				"delivered",
				"expired",
				"pending",
				"ready_for_pickup",
				"shipped",
			].sort(),
		);
		expect(body.data.confirmed).toBe(1);
	});

	it("negozio di un altro seller → 404", async () => {
		const { stranger, other } = await seed();
		const res = await call(
			stranger.user.id,
			"GET",
			`/orders/counts?storeId=${other.id}`,
		);
		expect(res.status).toBe(404);
	});

	it("employee su un negozio non assegnato → 403", async () => {
		const { empUserId, other } = await seed();
		const res = await call(
			empUserId,
			"GET",
			`/orders/counts?storeId=${other.id}`,
		);
		expect(res.status).toBe(403);
	});
});

describe("PATCH /orders/:orderId/cancel", () => {
	it("employee su un ordine di un negozio non assegnato → 404, ordine intatto", async () => {
		const { empUserId, orderOnOther } = await seed();
		const res = await call(
			empUserId,
			"PATCH",
			`/orders/${orderOnOther.id}/cancel`,
		);
		expect(res.status).toBe(404);
		const fresh = await getTestDb().query.order.findFirst({
			where: eq(order.id, orderOnOther.id),
		});
		expect(fresh?.status).toBe("confirmed");
	});

	it("un altro seller → 404", async () => {
		const { stranger, orderOnOther } = await seed();
		const res = await call(
			stranger.user.id,
			"PATCH",
			`/orders/${orderOnOther.id}/cancel`,
		);
		expect(res.status).toBe(404);
	});

	it("owner → 200 e ordine annullato", async () => {
		const { owner, orderOnOther } = await seed();
		const res = await call(
			owner.user.id,
			"PATCH",
			`/orders/${orderOnOther.id}/cancel`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.status).toBe("cancelled");
	});
});

describe("ritiro con codice via HTTP", () => {
	async function seedWithCode() {
		const seeded = await seed();
		await getTestDb()
			.update(order)
			.set({ pickupCode: "K7XM4P" })
			.where(eq(order.id, seeded.orderOnOther.id));
		return seeded;
	}

	it("anteprima: employee su un negozio non assegnato → 403; owner → 200", async () => {
		const { owner, empUserId, other, orderOnOther } = await seedWithCode();

		const denied = await call(
			empUserId,
			"GET",
			`/orders/pickup/K7XM4P?storeId=${other.id}`,
		);
		expect(denied.status).toBe(403);

		const preview = await call(
			owner.user.id,
			"GET",
			`/orders/pickup/k7x%20m4p?storeId=${other.id}`,
		);
		expect(preview.status).toBe(200);
		expect((await preview.json()).data.id).toBe(orderOnOther.id);
	});

	it("conferma: employee non assegnato → 403 e ordine intatto; owner → 200, poi 404", async () => {
		const { owner, empUserId, other, orderOnOther } = await seedWithCode();

		const denied = await call(empUserId, "POST", "/orders/pickup", {
			storeId: other.id,
			code: "K7XM4P",
		});
		expect(denied.status).toBe(403);
		const untouched = await getTestDb().query.order.findFirst({
			where: eq(order.id, orderOnOther.id),
		});
		expect(untouched?.status).toBe("confirmed");

		const done = await call(owner.user.id, "POST", "/orders/pickup", {
			storeId: other.id,
			code: "K7X-M4P",
		});
		expect(done.status).toBe(200);
		expect((await done.json()).data.status).toBe("completed");

		const again = await call(owner.user.id, "POST", "/orders/pickup", {
			storeId: other.id,
			code: "K7XM4P",
		});
		expect(again.status).toBe(404);
	});
});
