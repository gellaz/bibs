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

import { eq } from "drizzle-orm";
import { discount, discountProduct } from "@/db/schemas/discount";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { order } from "@/db/schemas/order";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { sellerProfile } from "@/db/schemas/seller";
import { truncateAll } from "../../../helpers/cleanup";
import {
	createTestCustomer,
	createTestDiscount,
	createTestDiscountProduct,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreSubscription,
} from "../../../helpers/fixtures";
import { signIn, testRequest } from "../../../helpers/hono-app";

// Le route di U7 (ordini, promozioni, checkout negozio, billing) sulla
// sub-app Hono, con sessioni better-auth vere: guardia seller, solo titolare,
// scritture e corpi delle risposte. Le risposte sono quelle dell'API di prima
// della migrazione: il file è nato contro `sellerModule` (commit 0642ef27,
// verde) e da allora cambia solo `call()`.

let sellerApp: typeof import("@/modules/seller").sellerApp;

beforeAll(async () => {
	await setupTestContainer();
	// dinamico: @/lib/auth cattura `db` alla valutazione
	({ sellerApp } = await import("@/modules/seller"));
}, 180_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

/** Una richiesta a /seller<path>. */
function call(path: string, init: RequestInit = {}) {
	return testRequest(sellerApp, path, init);
}

const as = (cookie: string, method = "GET") => ({
	method,
	headers: { cookie },
});
const json = (method: string, body: unknown, cookie?: string) => ({
	method,
	headers: {
		"content-type": "application/json",
		...(cookie ? { cookie } : {}),
	},
	body: JSON.stringify(body),
});

const fail = (error: string, message: string) => ({
	success: false,
	error,
	message,
});

const ISO = expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

let seq = 0;

/** Titolare con sessione, profilo attivo e un negozio. */
async function owner() {
	const s = await signIn(`u7-seller-${++seq}@test.com`, "seller");
	const [profile] = await getTestDb()
		.insert(sellerProfile)
		.values({ userId: s.userId, onboardingStatus: "active" })
		.returning();
	const store = await createTestStore(getTestDb(), profile.id);
	return { ...s, profileId: profile.id, store };
}

async function confirmedOrder(storeId: string, pickupCode = "K7XM4P") {
	const customer = await createTestCustomer(getTestDb());
	const [row] = await getTestDb()
		.insert(order)
		.values({
			customerProfileId: customer.profile.id,
			storeId,
			type: "reserve_pickup",
			status: "confirmed",
			total: "12.50",
			pickupCode,
			reservationExpiresAt: new Date(Date.now() + 86_400_000),
		})
		.returning();
	return row;
}

describe("guardia", () => {
	it("anonimo: 422 prima di 401, poi 401", async () => {
		const missing = await call("/orders");
		expect(missing.status).toBe(422);
		expect(await missing.json()).toEqual(
			fail("VALIDATION_ERROR", "Negozio: campo obbligatorio"),
		);
		const anon = await call("/discounts");
		expect(anon.status).toBe(401);
		expect(await anon.json()).toEqual(
			fail("UNAUTHORIZED", "Devi accedere per continuare"),
		);
	});

	it("cliente: 403 di ruolo; dipendente: 403 solo titolare", async () => {
		const customer = await signIn(`u7-customer-${++seq}@test.com`);
		const res = await call("/billing/summary", as(customer.cookie));
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual(
			fail("FORBIDDEN", "Accesso riservato a venditori e dipendenti"),
		);

		const o = await owner();
		const emp = await signIn(`u7-emp-${++seq}@test.com`, "employee");
		const [row] = await getTestDb()
			.insert(storeEmployee)
			.values({ sellerProfileId: o.profileId, userId: emp.userId })
			.returning();
		await getTestDb()
			.insert(storeEmployeeStores)
			.values({ storeEmployeeId: row.id, storeId: o.store.id });
		for (const [method, path] of [
			["GET", "/discounts"],
			["GET", "/billing/subscriptions"],
			["GET", `/stores/checkout/${crypto.randomUUID()}`],
		]) {
			const denied = await call(path, as(emp.cookie, method));
			expect(denied.status).toBe(403);
			expect(await denied.json()).toEqual(
				fail("FORBIDDEN", "Solo il titolare può eseguire questa operazione"),
			);
		}
		const orders = await call(`/orders?storeId=${o.store.id}`, as(emp.cookie));
		expect(orders.status).toBe(200);
	});
});

describe("promozioni", () => {
	it("crea (intero come stringa, data, campi ignoti tolti), legge, elenca", async () => {
		const o = await owner();
		const p = await createTestProduct(getTestDb(), o.profileId, {
			price: "10.00",
		});
		const created = await call(
			"/discounts",
			json(
				"POST",
				{
					title: "  Saldi  ",
					percent: "25",
					startsAt: "2026-01-01",
					endsAt: null,
					initialProductIds: [p.id],
					status: "archived",
					sellerProfileId: "altro",
					nested: { a: 1 },
				},
				o.cookie,
			),
		);
		expect(created.status).toBe(200);
		const body = await created.json();
		expect(body).toEqual({
			success: true,
			data: {
				id: expect.any(String),
				sellerProfileId: o.profileId,
				title: "Saldi",
				percent: 25,
				startsAt: "2026-01-01T00:00:00.000Z",
				endsAt: null,
				status: "active",
				createdAt: ISO,
				updatedAt: ISO,
			},
		});
		const id = body.data.id;

		const detail = await call(`/discounts/${id}`, as(o.cookie));
		expect(detail.status).toBe(200);
		expect((await detail.json()).data).toEqual({
			...body.data,
			productCount: 1,
		});

		const list = await call(
			"/discounts?state=assignable&search=sald&page=1&limit=5",
			as(o.cookie),
		);
		expect(list.status).toBe(200);
		expect(await list.json()).toEqual({
			success: true,
			data: [{ ...body.data, productCount: 1 }],
			pagination: { page: 1, limit: 5, total: 1 },
		});

		const products = await call(`/discounts/${id}/products`, as(o.cookie));
		expect(products.status).toBe(200);
		expect(await products.json()).toEqual({
			success: true,
			data: [
				{
					id: p.id,
					name: p.name,
					originalPrice: "10.00",
					discountedPrice: "7.50",
					brandId: null,
				},
			],
			pagination: { page: 1, limit: 20, total: 1 },
		});
	});

	it("modifica, pausa, archivia (409 la seconda volta)", async () => {
		const o = await owner();
		const d = await createTestDiscount(getTestDb(), o.profileId, {
			startsAt: new Date(Date.now() + 86_400_000),
			endsAt: null,
		});
		const patched = await call(
			`/discounts/${d.id}`,
			json(
				"PATCH",
				{ title: "Nuovo", endsAt: "2030-01-01T00:00:00.000Z", status: "x" },
				o.cookie,
			),
		);
		expect(patched.status).toBe(200);
		const pd = (await patched.json()).data;
		expect(pd.title).toBe("Nuovo");
		expect(pd.endsAt).toBe("2030-01-01T00:00:00.000Z");
		expect(pd.status).toBe("active");

		const paused = await call(`/discounts/${d.id}/pause`, as(o.cookie, "POST"));
		expect((await paused.json()).data.status).toBe("paused");
		const resumed = await call(
			`/discounts/${d.id}/pause`,
			as(o.cookie, "POST"),
		);
		expect((await resumed.json()).data.status).toBe("active");

		const archived = await call(
			`/discounts/${d.id}/archive`,
			as(o.cookie, "POST"),
		);
		expect(archived.status).toBe(200);
		expect((await archived.json()).data.status).toBe("archived");
		const again = await call(
			`/discounts/${d.id}/archive`,
			as(o.cookie, "POST"),
		);
		expect(again.status).toBe(409);
		expect((await again.json()).error).toBe("CONFLICT");
	});

	it("aggiunge e toglie prodotti (anche quelli di altri venditori)", async () => {
		const o = await owner();
		const other = await createTestSeller(getTestDb());
		const mine = await createTestProduct(getTestDb(), o.profileId);
		const present = await createTestProduct(getTestDb(), o.profileId);
		const foreign = await createTestProduct(getTestDb(), other.profile.id);
		const d = await createTestDiscount(getTestDb(), o.profileId);
		await createTestDiscountProduct(getTestDb(), d.id, present.id);

		const added = await call(
			`/discounts/${d.id}/products`,
			json(
				"POST",
				{ productIds: [mine.id, present.id, foreign.id], extra: 1 },
				o.cookie,
			),
		);
		expect(added.status).toBe(200);
		expect(await added.json()).toEqual({
			success: true,
			data: { added: 1, alreadyPresent: 1, rejected: [foreign.id] },
		});

		const removed = await call(
			`/discounts/${d.id}/products`,
			json("DELETE", { productIds: [mine.id] }, o.cookie),
		);
		expect(await removed.json()).toEqual({
			success: true,
			data: { removed: 1 },
		});

		const single = await call(
			`/discounts/${d.id}/products/${present.id}`,
			as(o.cookie, "DELETE"),
		);
		expect(await single.json()).toEqual({
			success: true,
			data: null,
			message: "Prodotto rimosso dalla promozione",
		});
		const left = await getTestDb()
			.select()
			.from(discountProduct)
			.where(eq(discountProduct.discountId, d.id));
		expect(left).toHaveLength(0);
	});

	it("422 e 404 con sessione", async () => {
		const o = await owner();
		const bad = await call(
			"/discounts",
			json(
				"POST",
				{ title: "x", percent: 5.5, startsAt: "2026-01-01" },
				o.cookie,
			),
		);
		expect(bad.status).toBe(422);
		expect(await bad.json()).toEqual(
			fail("VALIDATION_ERROR", "Percentuale: deve essere un numero intero"),
		);
		const missing = await call(
			`/discounts/${crypto.randomUUID()}`,
			as(o.cookie),
		);
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual(
			fail("NOT_FOUND", "Promozione non trovata"),
		);
		const rows = await getTestDb().select().from(discount);
		expect(rows).toHaveLength(0);
	});
});

describe("ordini", () => {
	it("lista, conteggi, dettaglio, pronto, ritiro con codice", async () => {
		const o = await owner();
		const ord = await confirmedOrder(o.store.id);

		const list = await call(
			`/orders?storeId=${o.store.id}&status=confirmed&limit=5`,
			as(o.cookie),
		);
		expect(list.status).toBe(200);
		const listBody = await list.json();
		expect(listBody.pagination).toEqual({ page: 1, limit: 5, total: 1 });
		expect(listBody.data[0]).toMatchObject({
			id: ord.id,
			status: "confirmed",
			type: "reserve_pickup",
			total: "12.50",
			pickupCode: "K7XM4P",
			reservationExpiresAt: ISO,
			createdAt: ISO,
			items: [],
			store: { id: o.store.id, name: o.store.name },
		});
		expect(listBody.data[0].store.location).toBeUndefined();

		const counts = await call(
			`/orders/counts?storeId=${o.store.id}&type=reserve_pickup`,
			as(o.cookie),
		);
		expect(await counts.json()).toEqual({
			success: true,
			data: {
				pending: 0,
				confirmed: 1,
				ready_for_pickup: 0,
				shipped: 0,
				delivered: 0,
				completed: 0,
				cancelled: 0,
				expired: 0,
			},
		});

		const detail = await call(`/orders/${ord.id}`, as(o.cookie));
		expect((await detail.json()).data).toEqual(listBody.data[0]);

		const ready = await call(`/orders/${ord.id}/ready`, as(o.cookie, "PATCH"));
		expect(ready.status).toBe(200);
		const readyBody = (await ready.json()).data;
		expect(readyBody.status).toBe("ready_for_pickup");
		expect(readyBody.items).toBeUndefined();

		const ship = await call(`/orders/${ord.id}/ship`, as(o.cookie, "PATCH"));
		expect(ship.status).toBe(400);
		expect(await ship.json()).toEqual(
			fail(
				"BAD_REQUEST",
				"Un ordine «pronto per il ritiro» non può diventare «spedito»",
			),
		);

		const done = await call(
			"/orders/pickup",
			json("POST", { storeId: o.store.id, code: "k7x-m4p" }, o.cookie),
		);
		expect(done.status).toBe(200);
		expect((await done.json()).data).toMatchObject({
			id: ord.id,
			status: "completed",
		});
	});

	it("completa e annulla", async () => {
		const o = await owner();
		const a = await confirmedOrder(o.store.id, "AAAAAA");
		const b = await confirmedOrder(o.store.id, "BBBBBB");
		const complete = await call(
			`/orders/${a.id}/complete`,
			as(o.cookie, "PATCH"),
		);
		expect(complete.status).toBe(200);
		expect((await complete.json()).data.status).toBe("completed");
		const cancel = await call(`/orders/${b.id}/cancel`, as(o.cookie, "PATCH"));
		expect(cancel.status).toBe(200);
		expect((await cancel.json()).data.status).toBe("cancelled");
		const again = await call(`/orders/${b.id}/cancel`, as(o.cookie, "PATCH"));
		expect(again.status).toBe(400);
		expect(await again.json()).toEqual(
			fail(
				"BAD_REQUEST",
				"Un ordine «annullato» non può diventare «annullato»",
			),
		);
	});
});

describe("billing", () => {
	it("riepilogo, abbonamenti, fatture senza cliente Stripe, portale 404", async () => {
		const o = await owner();
		await createTestStoreSubscription(getTestDb(), o.store.id);

		const summary = await call("/billing/summary", as(o.cookie));
		expect(summary.status).toBe(200);
		expect(await summary.json()).toEqual({
			success: true,
			data: {
				totalMonthlyCents: 1000,
				billableStoresCount: 1,
				nextRenewal: {
					storeId: o.store.id,
					storeName: o.store.name,
					date: ISO,
					amountCents: 1000,
				},
			},
		});

		const subs = await call("/billing/subscriptions", as(o.cookie));
		expect(await subs.json()).toEqual({
			success: true,
			data: [
				{
					storeId: o.store.id,
					storeName: o.store.name,
					status: "active",
					feeAmountCents: 1000,
					currency: expect.any(String),
					currentPeriodEnd: ISO,
					cancelAtPeriodEnd: false,
					suspendedAt: null,
				},
			],
		});

		const invoices = await call("/billing/invoices?limit=5", as(o.cookie));
		expect(await invoices.json()).toEqual({
			success: true,
			data: { data: [], hasMore: false },
		});

		const portal = await call("/billing/portal", as(o.cookie, "POST"));
		expect(portal.status).toBe(404);
		expect(await portal.json()).toEqual(
			fail("NOT_FOUND", "Nessun cliente Stripe associato a questo venditore"),
		);
	});
});

describe("checkout negozio", () => {
	it("stato della sessione, form in sospeso, riattivazione 409, orari 400", async () => {
		const o = await owner();
		await createTestStoreSubscription(getTestDb(), o.store.id);
		const formData = { name: "Bottega", nested: { a: [1, 2] } };
		const [pending] = await getTestDb()
			.insert(pendingStoreCreation)
			.values({
				sellerProfileId: o.profileId,
				stripeCheckoutSessionId: "cs_test_u7",
				status: "open",
				formData,
				feeAmountCents: 1000,
				expiresAt: new Date(Date.now() + 3_600_000),
			})
			.returning();

		const status = await call(
			"/checkout-sessions/cs_test_u7/status",
			as(o.cookie),
		);
		expect(await status.json()).toEqual({
			success: true,
			data: { status: "open" },
		});
		const unknown = await call(
			"/checkout-sessions/cs_nope/status",
			as(o.cookie),
		);
		expect(unknown.status).toBe(404);

		const resume = await call(`/stores/checkout/${pending.id}`, as(o.cookie));
		expect(await resume.json()).toEqual({ success: true, data: { formData } });

		const react = await call(
			`/stores/${o.store.id}/reactivation-checkout`,
			as(o.cookie, "POST"),
		);
		expect(react.status).toBe(409);
		expect(await react.json()).toEqual(
			fail("CONFLICT", "Negozio non cancellato"),
		);

		const hours = await call(
			"/stores/checkout",
			json(
				"POST",
				{
					name: "Nuovo",
					addressLine1: "Via Roma 1",
					municipalityId: o.store.municipalityId,
					zipCode: "40100",
					location: { x: 11.34, y: 44.49 },
					openingHours: [
						{ dayOfWeek: 0, slots: [{ open: "10:00", close: "09:00" }] },
					],
				},
				o.cookie,
			),
		);
		expect(hours.status).toBe(400);
		expect(await hours.json()).toEqual(
			fail(
				"BAD_REQUEST",
				"L'orario di chiusura (09:00) deve essere successivo all'apertura (10:00)",
			),
		);
	});
});
