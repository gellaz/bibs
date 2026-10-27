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
} from "../../../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));
mock.module("@/infra/email", () => ({ sendEmail: async () => {} }));

import { customerAddress } from "@/db/schemas/address";
import { customerProfile } from "@/db/schemas/customer";
import {
	createOrder,
	getCustomerOrder,
} from "@/modules/customer/services/orders";
import { truncateAll } from "../../../helpers/cleanup";
import {
	createTestCustomer,
	createTestMunicipality,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
} from "../../../helpers/fixtures";
import { signIn, testRequest } from "../../../helpers/hono-app";

// Il modulo customer/ sulla sub-app Hono (U3 del piano Hono), con sessioni
// better-auth vere: `requireCustomer` (401, 403, dopo i validatori) e strip dei
// campi fuori schema in ingresso e in uscita (la `normalize` di prima).

let customerApp: typeof import("@/modules/customer").customerApp;

beforeAll(async () => {
	await setupTestContainer();
	// dinamico: @/lib/auth cattura `db` alla valutazione
	({ customerApp } = await import("@/modules/customer"));
}, 180_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

/** Utente con sessione e profilo cliente. */
async function signInCustomer(email: string) {
	const session = await signIn(email);
	const [profile] = await getTestDb()
		.insert(customerProfile)
		.values({ userId: session.userId, points: 7 })
		.returning();
	return { ...session, profile };
}

async function orderFor(customerProfileId: string) {
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
	return createOrder({
		customerProfileId,
		customerPoints: 0,
		type: "reserve_pickup",
		storeId: store.id,
		items: [{ storeProductId: sp.id, quantity: 1 }],
	});
}

describe("customer/ su Hono: guardie", () => {
	it("prodotti e negozi sono pubblici", async () => {
		for (const path of ["/products", "/stores", "/stores/map"]) {
			const res = await testRequest(customerApp, path);
			expect(res.status).toBe(200);
		}
	});

	it("senza sessione: 401, ma 422 prima di 401 con un input non valido", async () => {
		const profile = await testRequest(customerApp, "/profile");
		expect(profile.status).toBe(401);
		expect(await profile.json()).toEqual({
			success: false,
			error: "UNAUTHORIZED",
			message: "Devi accedere per continuare",
		});
		const orders = await testRequest(customerApp, "/orders?page=0");
		expect(orders.status).toBe(422);
		expect(await orders.json()).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "Valore non valido: deve essere almeno 1",
		});
	});

	it("utente senza profilo cliente: 403 «Profilo cliente non trovato»", async () => {
		const { cookie } = await signIn("no-profile@test.com", "seller");
		const res = await testRequest(customerApp, "/cart", {
			headers: { cookie },
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			success: false,
			error: "FORBIDDEN",
			message: "Profilo cliente non trovato",
		});
	});

	it("cliente: il profilo senza le colonne fuori schema (updatedAt)", async () => {
		const { cookie, userId, profile } = await signInCustomer("c1@test.com");
		const res = await testRequest(customerApp, "/profile", {
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: {
				id: profile.id,
				userId,
				points: 7,
				createdAt: profile.createdAt.toISOString(),
			},
		});
	});
});

describe("customer/: strip (trappola normalize)", () => {
	it("un campo in più nel body non arriva al servizio", async () => {
		const db = getTestDb();
		const other = await createTestCustomer(db);
		const { cookie, profile } = await signInCustomer("c2@test.com");
		const mun = await createTestMunicipality(db);
		const res = await testRequest(customerApp, "/addresses", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				addressLine1: "Via Roma 1",
				municipalityId: mun.id,
				zipCode: "40100",
				// il servizio riceve `{ customerProfileId: cp.id, ...body }`
				customerProfileId: other.profile.id,
				location: { x: 11.34, y: 44.49, z: 1 },
				nested: { internal: true },
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.customerProfileId).toBe(profile.id);
		expect(body.data.location).toEqual({ x: 11.34, y: 44.49 });
		const rows = await db
			.select({ owner: customerAddress.customerProfileId })
			.from(customerAddress);
		expect(rows).toEqual([{ owner: profile.id }]);
	});

	it("un campo in più nella query non arriva al servizio", async () => {
		const other = await createTestCustomer(getTestDb());
		await orderFor(other.profile.id);
		const { cookie } = await signInCustomer("c3@test.com");
		const res = await testRequest(
			customerApp,
			`/orders?customerProfileId=${other.profile.id}&checkoutId=x`,
			{ headers: { cookie } },
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: [],
			pagination: { page: 1, limit: 20, total: 0 },
		});
	});

	it("le colonne interne dell'ordine non escono nella risposta", async () => {
		const { cookie, profile } = await signInCustomer("c4@test.com");
		const order = await orderFor(profile.id);
		const internal = [
			"idempotencyKey",
			"platformFee",
			"stripeTransferId",
			"stripePointsTransferId",
			"stripeRefundId",
		];
		// il servizio le restituisce…
		const raw = await getCustomerOrder({
			orderId: order.id,
			customerProfileId: profile.id,
		});
		for (const key of internal) expect(raw).toHaveProperty(key);
		// …la risposta no
		const res = await testRequest(customerApp, `/orders/${order.id}`, {
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.id).toBe(order.id);
		for (const key of internal) expect(data).not.toHaveProperty(key);
	});
});
