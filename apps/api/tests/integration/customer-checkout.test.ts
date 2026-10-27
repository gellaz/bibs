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
import { cartItem } from "@/db/schemas/cart";
import { checkout } from "@/db/schemas/checkout";
import { customerProfile as customerProfileTable } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { paymentMethod } from "@/db/schemas/payment-method";
import { product as productTable, storeProduct } from "@/db/schemas/product";
import { sellerProfile } from "@/db/schemas/seller";
import { store as storeTable } from "@/db/schemas/store";
import { reservationDeadline } from "@/domain/holidays";
import { checkoutRoutes } from "@/modules/customer/routes/checkout";
import {
	createCheckout,
	getCheckout,
} from "@/modules/customer/services/checkout";
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
import { withResolve } from "../helpers/hono-app";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

// Stessa forma della resolve del modulo customer, con l'utente da un header.
const app = withResolve(checkoutRoutes, async (request) => {
	const id = request.headers.get("x-test-user") ?? "";
	const db = getTestDb();
	const u = await db.query.user.findFirst({ where: eq(userTable.id, id) });
	const cp = await db.query.customerProfile.findFirst({
		where: eq(customerProfileTable.userId, id),
	});
	if (!u || !cp) throw new Error("test customer missing");
	return { user: u, customerProfile: cp };
});

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

describe("createCheckout — cambio partita IVA in attesa", () => {
	async function blockedAndFree() {
		const db = getTestDb();
		const blockedSeller = await createTestSeller(db);
		const freeSeller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const blocked = await sellable(blockedSeller.profile.id, "Bloccato");
		const free = await sellable(freeSeller.profile.id, "Libero");
		await createTestCartItem(db, customer.profile.id, blocked.sp.id);
		await createTestCartItem(db, customer.profile.id, free.sp.id);
		await db
			.update(sellerProfile)
			.set({ vatChangeBlocked: true })
			.where(eq(sellerProfile.id, blockedSeller.profile.id));
		return { db, customer, blocked, free };
	}

	it("rifiuta un ordine per un venditore con cambio partita IVA in attesa", async () => {
		const { db, customer, blocked } = await blockedAndFree();
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [{ storeId: blocked.store.id, type: "reserve_pickup" }],
			}),
		).rejects.toMatchObject({
			status: 400,
			message: "Bloccato non offre questa modalità d'acquisto",
		});
		expect(await db.select().from(order)).toHaveLength(0);
	});

	it("ordina dagli altri negozi del carrello quando uno è bloccato", async () => {
		const { customer, free } = await blockedAndFree();
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: free.store.id, type: "reserve_pickup" }],
		});
		expect(result.orders).toHaveLength(1);
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

		const res = await app.request(
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
		const res = await app.request(
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

describe("createCheckout — scadenza della prenotazione", () => {
	it("conta le ore di ritiro del negozio sulle sue ore di apertura", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const openingHours = Array.from({ length: 7 }, (_, i) => ({
			dayOfWeek: i,
			slots: [{ open: "08:00", close: "20:00" }],
		}));
		const store = await createTestStore(db, seller.profile.id, {
			openingHours,
			reservationHours: 2,
		});
		await createTestStoreSubscription(db, store.id);
		const product = await createTestProduct(db, seller.profile.id, {
			price: "10.00",
		});
		const sp = await createTestStoreProduct(db, store.id, product.id, {
			stock: 5,
		});
		await createTestCartItem(db, customer.profile.id, sp.id, { quantity: 1 });
		// Il DB di test non ha festività: bastano gli orari.
		const deadline = (from: Date) =>
			reservationDeadline({
				openingHours,
				closedDates: new Set(),
				from,
				hours: 2,
			}).expiresAt.getTime();

		const before = new Date();
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: store.id, type: "reserve_pickup" }],
		});
		const after = new Date();

		const expiresAt = result.orders[0].reservationExpiresAt!.getTime();
		expect(expiresAt).toBeGreaterThanOrEqual(deadline(before));
		expect(expiresAt).toBeLessThanOrEqual(deadline(after));
	});
});

describe("GET /checkout/reservation-deadlines", () => {
	const get = (customerUserId: string, storeIds: string[]) =>
		app.request(
			new Request(
				`http://localhost/checkout/reservation-deadlines?storeIds=${storeIds.join(",")}`,
				{ headers: { "x-test-user": customerUserId } },
			),
		);

	it("ore, scadenza e tipo di conteggio per negozio", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const openingHours = Array.from({ length: 7 }, (_, i) => ({
			dayOfWeek: i,
			slots: [{ open: "08:00", close: "20:00" }],
		}));
		const withHours = await createTestStore(db, seller.profile.id, {
			openingHours,
			reservationHours: 2,
		});
		await createTestStoreSubscription(db, withHours.id);
		const { store: noHours } = await sellable(seller.profile.id, "Senza orari");
		const deadline = (from: Date) =>
			reservationDeadline({
				openingHours,
				closedDates: new Set(),
				from,
				hours: 2,
			}).expiresAt.getTime();

		const before = new Date();
		const res = await get(customer.user.id, [withHours.id, noHours.id]);
		const after = new Date();

		expect(res.status).toBe(200);
		const { data } = await res.json();
		const byId = new Map(
			data.map((d: { storeId: string }) => [d.storeId, d] as const),
		);
		const a = byId.get(withHours.id) as any;
		expect(a.hours).toBe(2);
		expect(a.clock).toBe("opening");
		const expiresAt = new Date(a.expiresAt).getTime();
		expect(expiresAt).toBeGreaterThanOrEqual(deadline(before));
		expect(expiresAt).toBeLessThanOrEqual(deadline(after));
		const b = byId.get(noHours.id) as any;
		expect(b.hours).toBe(24);
		expect(b.clock).toBe("calendar");
	});

	it("omette i negozi non visibili", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const { store } = await sellable(seller.profile.id, "Chiuso");
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, store.id));

		const res = await get(customer.user.id, [store.id]);
		expect(res.status).toBe(200);
		expect((await res.json()).data).toEqual([]);
	});
});

describe("getCheckout — stato del negozio", () => {
	it("ogni ordine porta store.openStatus", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });
		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: a.store.id, type: "reserve_pickup" }],
		});

		const result = await getCheckout({
			checkoutId: created.id,
			customerProfileId: customer.profile.id,
		});
		expect(result.orders[0].store.openStatus?.status).toBe("unknown");
	});
});
