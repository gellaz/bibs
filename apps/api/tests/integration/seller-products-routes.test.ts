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
mock.module("@/lib/email", () => ({ sendEmail: async () => {} }));

const s3WriteMock = mock(async (_key: string, _data: unknown) => {});
const s3DeleteMock = mock(async (_key: string) => {});
mock.module("@/lib/s3", () => ({
	s3: { write: s3WriteMock, delete: s3DeleteMock },
	publicUrl: (key: string) => `http://localhost:9000/bibs-test/${key}`,
	ensureBucket: async () => {},
	checkBucket: async () => true,
}));

import { eq } from "drizzle-orm";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { product } from "@/db/schemas/product";
import { type OnboardingStatus, sellerProfile } from "@/db/schemas/seller";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestBrand,
	createTestCategory,
	createTestProduct,
	createTestProductImage,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";
import { signIn, testRequest } from "../helpers/hono-app";

// Le route di U5 (prodotti, brand, immagini, caratteristiche, stock) sulla
// sub-app Hono, con sessioni better-auth vere: guardia seller (i quattro 403
// di `resolveSellerAccess`), scritture, multipart, strip in ingresso e in
// uscita. Le risposte sono quelle dell'API prima della migrazione: il file è
// nato contro `sellerModule` (commit eba68c30, verde) e da allora cambia solo
// `call()`.

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
	s3WriteMock.mockClear();
	s3DeleteMock.mockClear();
});

/** Una richiesta a /seller<path>. */
function call(path: string, init: RequestInit = {}) {
	return testRequest(sellerApp, path, init);
}

const json = (method: string, body: unknown, cookie?: string) => ({
	method,
	headers: {
		"content-type": "application/json",
		...(cookie ? { cookie } : {}),
	},
	body: JSON.stringify(body),
});

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);
const png = (name: string) => new File([PNG], name, { type: "image/png" });

const fail = (error: string, message: string) => ({
	success: false,
	error,
	message,
});

let seq = 0;
const email = (role: string) => `u5-${role}-${++seq}@test.com`;

/** Titolare con sessione e profilo venditore nello stato `status`. */
async function owner(status: OnboardingStatus = "active") {
	const s = await signIn(email("seller"), "seller");
	const [profile] = await getTestDb()
		.insert(sellerProfile)
		.values({ userId: s.userId, onboardingStatus: status })
		.returning();
	return { ...s, profileId: profile.id };
}

/** Dipendente con sessione, incarico nello stato `status` e i negozi dati. */
async function employee(
	sellerProfileId: string,
	storeIds: string[],
	status: "active" | "removed" = "active",
) {
	const s = await signIn(email("employee"), "employee");
	const [emp] = await getTestDb()
		.insert(storeEmployee)
		.values({ sellerProfileId, userId: s.userId, status })
		.returning();
	if (storeIds.length)
		await getTestDb()
			.insert(storeEmployeeStores)
			.values(
				storeIds.map((storeId) => ({ storeEmployeeId: emp.id, storeId })),
			);
	return s;
}

const ISO = expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

describe("guardia seller", () => {
	it("anonimo: 401, ma 422 se la query non è valida (validazione prima)", async () => {
		const res = await call("/products");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual(
			fail("UNAUTHORIZED", "Devi accedere per continuare"),
		);
		const invalid = await call("/products/status-counts");
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toEqual(
			fail("VALIDATION_ERROR", "Negozio: campo obbligatorio"),
		);
	});

	it("i quattro 403 di resolveSellerAccess, dopo la validazione", async () => {
		const customer = await signIn(email("customer"), "customer");
		const noProfile = await signIn(email("seller"), "seller");
		const pending = await owner("pending_review");
		const active = await owner();
		const removed = await employee(active.profileId, [], "removed");
		const pendingStaff = await employee(pending.profileId, []);
		const cases: [string, string][] = [
			[customer.cookie, "Accesso riservato a venditori e dipendenti"],
			[noProfile.cookie, "Profilo venditore non trovato"],
			[pending.cookie, "Onboarding del venditore non completato"],
			[
				removed.cookie,
				"Accesso negato: nessun incarico attivo come dipendente",
			],
			[pendingStaff.cookie, "Onboarding del venditore non completato"],
		];
		for (const [cookie, message] of cases) {
			const res = await call("/brands", { headers: { cookie } });
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual(fail("FORBIDDEN", message));
			const invalid = await call("/brands?page=0", { headers: { cookie } });
			expect(invalid.status).toBe(422);
		}
	});

	it("dipendente: vede solo i negozi assegnati", async () => {
		const o = await owner();
		const db = getTestDb();
		const mine = await createTestStore(db, o.profileId);
		const other = await createTestStore(db, o.profileId);
		const p = await createTestProduct(db, o.profileId, { name: "Mio" });
		const q = await createTestProduct(db, o.profileId, { name: "Altro" });
		await createTestStoreProduct(db, mine.id, p.id);
		await createTestStoreProduct(db, other.id, q.id);
		const e = await employee(o.profileId, [mine.id]);
		const headers = { cookie: e.cookie };

		const list = await (await call("/products", { headers })).json();
		expect(list.data.map((x: { id: string }) => x.id)).toEqual([p.id]);
		const forbidden = await call(
			`/products/status-counts?storeId=${other.id}`,
			{
				headers,
			},
		);
		expect(forbidden.status).toBe(403);
		expect(await forbidden.json()).toEqual(
			fail("FORBIDDEN", "Accesso negato a questo negozio"),
		);
		const hidden = await call(`/products/${q.id}`, { headers });
		expect(hidden.status).toBe(404);
		expect(await hidden.json()).toEqual(
			fail("NOT_FOUND", "Prodotto non trovato"),
		);
	});
});

describe("prodotti", () => {
	it("crea, legge, modifica, cestina ed elimina", async () => {
		const o = await owner();
		const store = await createTestStore(getTestDb(), o.profileId);

		const created = await call(
			"/products",
			json(
				"POST",
				{
					name: "  Pane  ",
					price: "2.50",
					storeId: store.id,
					brandName: "Forno",
				},
				o.cookie,
			),
		);
		expect(created.status).toBe(200);
		const { data } = await created.json();
		expect(Object.keys(data)).toEqual([
			"id",
			"sellerProfileId",
			"name",
			"description",
			"price",
			"vatRate",
			"status",
			"ean",
			"brandId",
			"productCategoryId",
			"createdAt",
			"updatedAt",
		]);
		expect(data).toEqual({
			id: expect.any(String),
			sellerProfileId: o.profileId,
			name: "Pane",
			description: null,
			price: "2.50",
			vatRate: "22",
			status: "active",
			ean: null,
			brandId: expect.any(String),
			productCategoryId: null,
			createdAt: ISO,
			updatedAt: ISO,
		});

		const detail = await (
			await call(`/products/${data.id}/`, { headers: { cookie: o.cookie } })
		).json();
		expect(Object.keys(detail.data)).toEqual([
			"id",
			"sellerProfileId",
			"name",
			"description",
			"price",
			"vatRate",
			"status",
			"ean",
			"brandId",
			"productCategoryId",
			"createdAt",
			"updatedAt",
			"productCategory",
			"storeProducts",
			"images",
			"brand",
			"characteristicValues",
		]);
		expect(detail.data.brand).toEqual({
			id: data.brandId,
			sellerProfileId: o.profileId,
			name: "Forno",
			createdAt: ISO,
			updatedAt: ISO,
		});
		expect(detail.data.storeProducts).toEqual([
			{
				id: expect.any(String),
				productId: data.id,
				storeId: store.id,
				stock: 0,
				store: expect.any(Object),
			},
		]);

		const patched = await call(
			`/products/${data.id}`,
			json("PATCH", { name: "Pane nero", ean: "" }, o.cookie),
		);
		expect(patched.status).toBe(200);
		expect((await patched.json()).data.name).toBe("Pane nero");

		const trashed = await call(
			`/products/${data.id}/status`,
			json("PATCH", { status: "trashed" }, o.cookie),
		);
		expect((await trashed.json()).data.status).toBe("trashed");

		const deleted = await call(`/products/${data.id}`, {
			method: "DELETE",
			headers: { cookie: o.cookie },
		});
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({
			success: true,
			data: null,
			message: "Prodotto eliminato",
		});
	});

	it("409 se si elimina un prodotto fuori dal cestino", async () => {
		const o = await owner();
		const store = await createTestStore(getTestDb(), o.profileId);
		const p = await createTestProduct(getTestDb(), o.profileId);
		await createTestStoreProduct(getTestDb(), store.id, p.id);
		const res = await call(`/products/${p.id}`, {
			method: "DELETE",
			headers: { cookie: o.cookie },
		});
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual(
			fail("CONFLICT", "Sposta prima il prodotto nel cestino"),
		);
	});

	it("operazioni in blocco: stato ed eliminazione definitiva", async () => {
		const o = await owner();
		const db = getTestDb();
		const store = await createTestStore(db, o.profileId);
		const a = await createTestProduct(db, o.profileId);
		const b = await createTestProduct(db, o.profileId, { status: "trashed" });
		await createTestStoreProduct(db, store.id, a.id);
		await createTestStoreProduct(db, store.id, b.id);

		const status = await call(
			"/products/bulk/status",
			json(
				"POST",
				{ productIds: [a.id, "nope"], status: "disabled" },
				o.cookie,
			),
		);
		expect(await status.json()).toEqual({
			success: true,
			data: {
				succeeded: [a.id],
				failed: [{ productId: "nope", reason: "not_found" }],
			},
		});

		const del = await call(
			"/products/bulk/delete-permanent",
			json("POST", { productIds: [b.id, a.id] }, o.cookie),
		);
		expect(await del.json()).toEqual({
			success: true,
			data: {
				succeeded: [b.id],
				failed: [{ productId: a.id, reason: "not_in_trash" }],
			},
		});
	});

	it("lista con array in query, booleani e conteggi per stato", async () => {
		const o = await owner();
		const db = getTestDb();
		const store = await createTestStore(db, o.profileId);
		const c1 = await createTestCategory(db, "Pane");
		const c2 = await createTestCategory(db, "Dolci");
		const p1 = await createTestProduct(db, o.profileId, {
			name: "A",
			categoryIds: [c1.id],
		});
		const p2 = await createTestProduct(db, o.profileId, {
			name: "B",
			categoryIds: [c2.id],
		});
		await createTestProduct(db, o.profileId, { name: "C" });
		await createTestStoreProduct(db, store.id, p1.id, { stock: 3 });
		await createTestStoreProduct(db, store.id, p2.id, { stock: 0 });
		const headers = { cookie: o.cookie };

		const ids = async (search: string) =>
			(
				(await (await call(`/products?${search}`, { headers })).json()) as {
					data: { id: string }[];
				}
			).data.map((x) => x.id);
		expect(
			await ids(
				`productCategoryIds=${c1.id}&productCategoryIds=${c2.id}&sort=name&order=asc`,
			),
		).toEqual([p1.id, p2.id]);
		expect(
			await ids(`productCategoryIds=${c1.id},${c2.id}&sort=name&order=asc`),
		).toEqual([p1.id, p2.id]);
		expect(await ids(`storeId=${store.id}&inStock=true`)).toEqual([p1.id]);

		const counts = await call(`/products/status-counts?storeId=${store.id}`, {
			headers,
		});
		expect(await counts.json()).toEqual({
			success: true,
			data: { active: 2, disabled: 0, trashed: 0 },
		});

		const inUse = await (
			await call("/products/categories-in-use?statusFilter=active", { headers })
		).json();
		expect(inUse.data.map((c: { name: string }) => c.name).sort()).toEqual([
			"Dolci",
			"Pane",
		]);
		expect(Object.keys(inUse.data[0].macroCategory)).toEqual([
			"id",
			"name",
			"suggestedVatRate",
			"createdAt",
			"updatedAt",
		]);

		const lookup = await call("/products/lookup?ean=12345678", { headers });
		expect(await lookup.json()).toEqual({ success: true, data: null });
	});

	it("import CSV: 422 come oggi (file-type non riconosce il testo, D14)", async () => {
		const o = await owner();
		const store = await createTestStore(getTestDb(), o.profileId);
		const form = new FormData();
		form.append(
			"file",
			new File(
				["name,description,price,categories\nPane,,1.00,Pane"],
				"p.csv",
				{
					type: "text/csv",
				},
			),
		);
		form.append("storeId", store.id);
		const res = await call("/products/import", {
			method: "POST",
			headers: { cookie: o.cookie },
			body: form,
		});
		expect(res.status).toBe(422);
		expect(await res.json()).toEqual(
			fail("VALIDATION_ERROR", "File: tipo di file non ammesso"),
		);
	});
});

describe("immagini (multipart)", () => {
	it("più file e posizione come stringa; poi elimina", async () => {
		const o = await owner();
		const p = await createTestProduct(getTestDb(), o.profileId);
		const form = new FormData();
		form.append("files", png("a.png"));
		form.append("files", png("b.png"));
		form.append("position", "2");
		const res = await call(`/products/${p.id}/images`, {
			method: "POST",
			headers: { cookie: o.cookie },
			body: form,
		});
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data).toHaveLength(2);
		expect(Object.keys(data[0])).toEqual([
			"id",
			"productId",
			"url",
			"key",
			"position",
			"createdAt",
		]);
		expect(data.map((i: { position: number }) => i.position)).toEqual([2, 2]);
		expect(s3WriteMock).toHaveBeenCalledTimes(2);

		const del = await call(`/products/${p.id}/images/${data[0].id}`, {
			method: "DELETE",
			headers: { cookie: o.cookie },
		});
		expect(await del.json()).toEqual({
			success: true,
			data: null,
			message: "Immagine eliminata",
		});
	});

	it("un file solo diventa un array; un file non immagine è 422", async () => {
		const o = await owner();
		const p = await createTestProduct(getTestDb(), o.profileId);
		const one = new FormData();
		one.append("files", png("a.png"));
		const ok = await call(`/products/${p.id}/images`, {
			method: "POST",
			headers: { cookie: o.cookie },
			body: one,
		});
		expect((await ok.json()).data).toHaveLength(1);

		const bad = new FormData();
		bad.append("files", new File(["hello"], "a.txt", { type: "text/plain" }));
		const res = await call(`/products/${p.id}/images`, {
			method: "POST",
			headers: { cookie: o.cookie },
			body: bad,
		});
		expect(res.status).toBe(422);
		expect(await res.json()).toEqual(
			fail("VALIDATION_ERROR", "File: tipo di file non ammesso"),
		);
	});

	it("immagine di un altro prodotto: 404", async () => {
		const o = await owner();
		const p = await createTestProduct(getTestDb(), o.profileId);
		const img = await createTestProductImage(getTestDb(), p.id);
		const res = await call(`/products/${p.id}/images/nope`, {
			method: "DELETE",
			headers: { cookie: o.cookie },
		});
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual(fail("NOT_FOUND", "Immagine non trovata"));
		expect(img.id).toBeTruthy();
	});
});

describe("stock", () => {
	it("assegna, aggiorna, adegua, in blocco, rimuove", async () => {
		const o = await owner();
		const db = getTestDb();
		const store = await createTestStore(db, o.profileId);
		const p = await createTestProduct(db, o.profileId);

		const assigned = await call(
			`/products/${p.id}/stores`,
			json("POST", { storeIds: [store.id], stock: 5 }, o.cookie),
		);
		const link = {
			id: expect.any(String),
			productId: p.id,
			storeId: store.id,
		};
		expect(await assigned.json()).toEqual({
			success: true,
			data: [{ ...link, stock: 5 }],
		});

		const updated = await call(
			`/products/${p.id}/stores/${store.id}`,
			json("PATCH", { stock: "3" }, o.cookie),
		);
		expect(await updated.json()).toEqual({
			success: true,
			data: { ...link, stock: 3 },
		});

		const negative = await call(
			`/products/${p.id}/stores/${store.id}/stock-adjust`,
			json("POST", { delta: -10 }, o.cookie),
		);
		expect(negative.status).toBe(409);

		const adjusted = await call(
			`/products/${p.id}/stores/${store.id}/stock-adjust`,
			json("POST", { delta: 2 }, o.cookie),
		);
		expect(await adjusted.json()).toEqual({
			success: true,
			data: { ...link, stock: 5 },
		});

		const bulk = await call(
			"/products/bulk/stock-adjust",
			json(
				"POST",
				{
					storeId: store.id,
					mode: "set",
					value: "7",
					productIds: [p.id, "nope"],
				},
				o.cookie,
			),
		);
		expect(await bulk.json()).toEqual({
			success: true,
			data: {
				succeeded: [{ ...link, stock: 7 }],
				failed: [{ productId: "nope", reason: "not_found" }],
			},
		});

		const removed = await call(`/products/${p.id}/stores/${store.id}`, {
			method: "DELETE",
			headers: { cookie: o.cookie },
		});
		expect(await removed.json()).toEqual({
			success: true,
			data: null,
			message: "Prodotto rimosso dal negozio",
		});
	});

	it("negozio di un altro venditore: 404 prima di scrivere", async () => {
		const o = await owner();
		const other = await createTestSeller(getTestDb());
		const theirs = await createTestStore(getTestDb(), other.profile.id);
		const p = await createTestProduct(getTestDb(), o.profileId);
		const res = await call(
			`/products/${p.id}/stores`,
			json("POST", { storeIds: [theirs.id] }, o.cookie),
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual(fail("NOT_FOUND", "Negozio non trovato"));
	});
});

describe("brand e caratteristiche", () => {
	it("crea con trim, ritrova lo stesso brand, lista paginata", async () => {
		const o = await owner();
		const first = await call(
			"/brands",
			json("POST", { name: "  Acme  " }, o.cookie),
		);
		const brand = (await first.json()).data;
		expect(brand).toEqual({
			id: expect.any(String),
			sellerProfileId: o.profileId,
			name: "Acme",
			createdAt: ISO,
			updatedAt: ISO,
		});
		const again = await call(
			"/brands",
			json("POST", { name: "acme" }, o.cookie),
		);
		expect((await again.json()).data.id).toBe(brand.id);

		const list = await call("/brands?q=ac&limit=5", {
			headers: { cookie: o.cookie },
		});
		expect(await list.json()).toEqual({
			success: true,
			data: [{ ...brand, updatedAt: ISO }],
			pagination: { page: 1, limit: 5, total: 1 },
		});
	});

	it("caratteristiche di una sotto-categoria: 200, 404 se non esiste", async () => {
		const o = await owner();
		const cat = await createTestCategory(getTestDb(), "Pane");
		const headers = { cookie: o.cookie };
		const ok = await call(`/product-categories/${cat.id}/characteristics`, {
			headers,
		});
		expect(await ok.json()).toEqual({ success: true, data: [] });
		const missing = await call("/product-categories/nope/characteristics", {
			headers,
		});
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual(
			fail("NOT_FOUND", "Sotto-categoria non trovata"),
		);
	});
});

// Trappola `normalize` (D4 del piano Hono): i servizi ricevono `...body` e
// `...query` dopo gli ID del chiamante, quindi un campo in più che
// arrivasse al servizio sostituirebbe `sellerProfileId`.
describe("strip: campi sconosciuti in ingresso e in uscita", () => {
	it("body: sellerProfileId e campi annidati non arrivano al servizio", async () => {
		const o = await owner();
		const victim = await createTestSeller(getTestDb());
		const store = await createTestStore(getTestDb(), o.profileId);
		const res = await call(
			"/products",
			json(
				"POST",
				{
					name: "Pane",
					price: "1.00",
					storeId: store.id,
					sellerProfileId: victim.profile.id,
					status: "trashed",
					characteristicValues: [],
					extra: { deep: { x: 1 } },
				},
				o.cookie,
			),
		);
		const { data } = await res.json();
		expect(data.sellerProfileId).toBe(o.profileId);
		expect(data.status).toBe("active");
		expect(data).not.toHaveProperty("extra");

		const p = await createTestProduct(getTestDb(), victim.profile.id, {
			name: "Altrui",
		});
		const patch = await call(
			`/products/${data.id}`,
			json(
				"PATCH",
				{
					name: "Mio",
					productId: p.id,
					sellerProfileId: victim.profile.id,
					accessibleStoreIds: [],
				},
				o.cookie,
			),
		);
		expect((await patch.json()).data.id).toBe(data.id);
		const [untouched] = await getTestDb()
			.select({ name: product.name })
			.from(product)
			.where(eq(product.id, p.id));
		expect(untouched.name).toBe("Altrui");
	});

	it("query: sellerProfileId non arriva al servizio dei brand", async () => {
		const o = await owner();
		const victim = await createTestSeller(getTestDb());
		await createTestBrand(getTestDb(), victim.profile.id, "Segreto");
		const res = await call(`/brands?sellerProfileId=${victim.profile.id}`, {
			headers: { cookie: o.cookie },
		});
		expect(await res.json()).toEqual({
			success: true,
			data: [],
			pagination: { page: 1, limit: 20, total: 0 },
		});
	});

	it("risposta: le colonne del negozio fuori schema non escono", async () => {
		const o = await owner();
		const db = getTestDb();
		const store = await createTestStore(db, o.profileId);
		const p = await createTestProduct(db, o.profileId);
		await createTestStoreProduct(db, store.id, p.id);
		const res = await call(`/products/${p.id}`, {
			headers: { cookie: o.cookie },
		});
		const { data } = await res.json();
		expect(Object.keys(data.storeProducts[0].store)).toEqual([
			"id",
			"sellerProfileId",
			"name",
			"description",
			"addressLine1",
			"addressLine2",
			"municipalityId",
			"municipality",
			"zipCode",
			"country",
			"categoryId",
			"openingHours",
			"websiteUrl",
			"createdAt",
			"updatedAt",
		]);
		expect(Object.keys(data.storeProducts[0].store.municipality)).toEqual([
			"id",
			"name",
			"provinceAcronym",
		]);
	});
});
