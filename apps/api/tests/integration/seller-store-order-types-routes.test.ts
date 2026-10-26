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
import { user as userTable } from "@/db/schemas/auth";
import { resolveSellerAccess } from "@/modules/seller/context";
import { storesRoutes } from "@/modules/seller/routes/stores";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestEmployee,
	createTestSeller,
	createTestStore,
} from "../helpers/fixtures";
import { withResolve } from "../helpers/hono-app";

// Stessa resolve della guardia seller vera, utente da header.
const app = withResolve(storesRoutes, async (request) => {
	const id = request.headers.get("x-test-user") ?? "";
	const u = await getTestDb().query.user.findFirst({
		where: eq(userTable.id, id),
	});
	if (!u) throw new Error("test user missing");
	return { user: u, seller: await resolveSellerAccess(u) };
});

function call(userId: string, method: string, path: string, body?: unknown) {
	return app.request(
		new Request(`http://localhost${path}`, {
			method,
			headers: {
				"x-test-user": userId,
				...(body ? { "content-type": "application/json" } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
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

async function setup() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const assigned = await createTestStore(db, seller.profile.id);
	const other = await createTestStore(db, seller.profile.id);
	const employee = await createTestEmployee(db, seller.profile.id, {
		storeIds: [assigned.id],
	});
	return { ownerId: seller.user.id, employee, assigned, other };
}

describe("GET /stores/:storeId/order-types — chi può leggere", () => {
	it("il titolare legge le tipologie del suo negozio", async () => {
		const s = await setup();
		const res = await call(
			s.ownerId,
			"GET",
			`/stores/${s.assigned.id}/order-types`,
		);
		expect(res.status).toBe(200);
	});

	it("il dipendente legge quelle del negozio a cui è assegnato", async () => {
		const s = await setup();
		const res = await call(
			s.employee.userId,
			"GET",
			`/stores/${s.assigned.id}/order-types`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { offeredOrderTypes: string[] };
		};
		expect(body.data.offeredOrderTypes).toEqual(["reserve_pickup"]);
	});

	it("il dipendente non legge quelle di un negozio non assegnato", async () => {
		const s = await setup();
		const res = await call(
			s.employee.userId,
			"GET",
			`/stores/${s.other.id}/order-types`,
		);
		expect(res.status).toBe(403);
	});

	it("il dipendente non può cambiarle", async () => {
		const s = await setup();
		const res = await call(
			s.employee.userId,
			"PATCH",
			`/stores/${s.assigned.id}/order-types`,
			{ orderTypes: ["reserve_pickup"] },
		);
		expect(res.status).toBe(403);
	});
});
