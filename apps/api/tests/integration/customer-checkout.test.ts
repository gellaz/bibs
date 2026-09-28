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
import { cartItem } from "@/db/schemas/cart";
import { checkout } from "@/db/schemas/checkout";
import { customerProfile as customerProfileTable } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { paymentMethod } from "@/db/schemas/payment-method";
import { product as productTable, storeProduct } from "@/db/schemas/product";
import { store as storeTable } from "@/db/schemas/store";
import { checkoutRoutes } from "@/modules/customer/routes/checkout";
import {
	createCheckout,
	getCheckout,
} from "@/modules/customer/services/checkout";
import { errorHandler } from "@/plugins/error-handler";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCartItem,
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

// Stessa forma della resolve del modulo customer, con l'utente da un header.
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
	.use(checkoutRoutes);

async function sellable(sellerProfileId: string, storeName: string, stock = 5) {
	const db = getTestDb();
	const store = await createTestStore(db, sellerProfileId, { name: storeName });
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, sellerProfileId, {
		price: "10.00",
	});
	const sp = await createTestStoreProduct(db, store.id, product.id, { stock });
	return { store, product, sp };
}

describe("createCheckout", () => {
	it("crea una prenotazione per negozio e toglie dal carrello solo le righe ordinate", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		const b = await sellable(seller.profile.id, "Negozio B");
		const c = await sellable(seller.profile.id, "Negozio C");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 2 });
		await createTestCartItem(db, customer.profile.id, b.sp.id, { quantity: 1 });
		await createTestCartItem(db, customer.profile.id, c.sp.id, { quantity: 1 });

		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [
				{ storeId: a.store.id, type: "reserve_pickup" },
				{ storeId: b.store.id, type: "reserve_pickup" },
			],
		});

		expect(result.orders).toHaveLength(2);
		for (const o of result.orders) {
			expect(o.type).toBe("reserve_pickup");
			expect(o.status).toBe("confirmed");
			expect(o.checkoutId).toBe(result.id);
			expect(o.reservationExpiresAt).not.toBeNull();
		}
		const left = await db
			.select()
			.from(cartItem)
			.where(eq(cartItem.customerProfileId, customer.profile.id));
		expect(left.map((r) => r.storeProductId)).toEqual([c.sp.id]);
		const [spA] = await db
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.id, a.sp.id));
		expect(spA.stock).toBe(3);
	});

	it("con una riga a stock insufficiente non crea nulla e lascia il carrello intatto", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		const b = await sellable(seller.profile.id, "Negozio B", 1);
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });
		await createTestCartItem(db, customer.profile.id, b.sp.id, { quantity: 1 });
		await db
			.update(storeProduct)
			.set({ stock: 0 })
			.where(eq(storeProduct.id, b.sp.id));

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [
					{ storeId: a.store.id, type: "reserve_pickup" },
					{ storeId: b.store.id, type: "reserve_pickup" },
				],
			}),
		).rejects.toMatchObject({ status: 409 });

		expect(await db.select().from(order)).toHaveLength(0);
		expect(await db.select().from(checkout)).toHaveLength(0);
		expect(
			await db
				.select()
				.from(cartItem)
				.where(eq(cartItem.customerProfileId, customer.profile.id)),
		).toHaveLength(2);
	});

	it("salta le righe non disponibili e le lascia nel carrello", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		const other = await createTestProduct(db, seller.profile.id, {
			price: "4.00",
		});
		const spOff = await createTestStoreProduct(db, a.store.id, other.id, {
			stock: 5,
		});
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });
		await createTestCartItem(db, customer.profile.id, spOff.id, {
			quantity: 1,
		});
		await db
			.update(productTable)
			.set({ status: "disabled" })
			.where(eq(productTable.id, other.id));

		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: a.store.id, type: "reserve_pickup" }],
		});

		expect(result.orders[0].items).toHaveLength(1);
		expect(result.orders[0].total).toBe("10.00");
		const left = await db
			.select()
			.from(cartItem)
			.where(eq(cartItem.customerProfileId, customer.profile.id));
		expect(left.map((r) => r.storeProductId)).toEqual([spOff.id]);
	});

	it("la stessa key restituisce lo stesso checkout senza ordini in più", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });
		const params = {
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: a.store.id, type: "reserve_pickup" as const }],
		};

		const first = await createCheckout(params);
		const second = await createCheckout(params);

		expect(second.id).toBe(first.id);
		expect(second.orders.map((o) => o.id)).toEqual(
			first.orders.map((o) => o.id),
		);
		expect(await db.select().from(order)).toHaveLength(1);
	});

	it("rifiuta pay_pickup con conto non abilitato (400)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await db
			.update(storeTable)
			.set({ orderTypes: ["reserve_pickup", "pay_pickup"] })
			.where(eq(storeTable.id, a.store.id));
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_T",
			chargesEnabled: false,
		});
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [{ storeId: a.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("un negozio senza righe acquistabili nel carrello è 409", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		const b = await sellable(seller.profile.id, "Negozio B");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [{ storeId: b.store.id, type: "reserve_pickup" }],
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("storeId duplicati sono 400", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [
					{ storeId: a.store.id, type: "reserve_pickup" },
					{ storeId: a.store.id, type: "reserve_pickup" },
				],
			}),
		).rejects.toMatchObject({ status: 400 });
	});
});

describe("getCheckout", () => {
	it("restituisce gli ordini del checkout solo al suo cliente", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const stranger = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });
		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: a.store.id, type: "reserve_pickup" }],
		});

		const view = await getCheckout({
			checkoutId: created.id,
			customerProfileId: customer.profile.id,
		});
		expect(view.orders.map((o) => o.store.name)).toEqual(["Negozio A"]);

		await expect(
			getCheckout({
				checkoutId: created.id,
				customerProfileId: stranger.profile.id,
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("POST /checkout", () => {
	it("crea il checkout e la risposta rispetta lo schema", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });

		const res = await app.handle(
			new Request("http://localhost/checkout", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-test-user": customer.user.id,
				},
				body: JSON.stringify({
					idempotencyKey: crypto.randomUUID(),
					stores: [{ storeId: a.store.id, type: "reserve_pickup" }],
				}),
			}),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.orders).toHaveLength(1);
	});

	it("body senza negozi → 422", async () => {
		const db = getTestDb();
		const customer = await createTestCustomer(db);
		const res = await app.handle(
			new Request("http://localhost/checkout", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-test-user": customer.user.id,
				},
				body: JSON.stringify({
					idempotencyKey: crypto.randomUUID(),
					stores: [],
				}),
			}),
		);
		expect(res.status).toBe(422);
	});
});
