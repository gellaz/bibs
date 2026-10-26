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

import { testClient } from "hono/testing";
import { truncateAll } from "../../../helpers/cleanup";
import { signIn, testRequest } from "../../../helpers/hono-app";

// Le route admin di U8 e il catalogo pubblico sulla sub-app Hono (con la sua
// fabbrica, da sola), con sessioni better-auth vere: guardia admin dopo
// la validazione (422 prima di 401/403), import CSV col FormData che
// costruisce il client `hc`, DELETE con corpo JSON. Attesi catturati su
// prima della migrazione (`baseline/hono-batch-admin-1.jsonl`).

let adminApp: typeof import("@/modules/admin").adminApp;
let catalog: typeof import("@/modules/catalog");

beforeAll(async () => {
	await setupTestContainer();
	// dinamici: @/lib/auth cattura `db` alla valutazione
	({ adminApp } = await import("@/modules/admin"));
	catalog = await import("@/modules/catalog");
}, 180_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

const json = (method: string, body: unknown, cookie?: string) => ({
	method,
	headers: {
		"content-type": "application/json",
		...(cookie ? { cookie } : {}),
	},
	body: JSON.stringify(body),
});

/** Il client `hc` dei FE, che chiama la sub-app in processo. */
const client = (cookie: string) =>
	testClient(adminApp, undefined, undefined, { headers: { cookie } });

const csv = (lines: string[]) =>
	new File([lines.join("\n")], "import.csv", { type: "text/csv" });

describe("requireAdmin dopo i validatori", () => {
	it("anonimo: 422 se l'input non è valido, altrimenti 401", async () => {
		const invalid = await testRequest(
			adminApp,
			"/product-categories",
			json("POST", {}),
		);
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "Nome: campo obbligatorio",
		});
		const res = await testRequest(adminApp, "/configurations/counts");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			success: false,
			error: "UNAUTHORIZED",
			message: "Devi accedere per continuare",
		});
	});

	it("utente non admin: 403, sempre dopo la validazione", async () => {
		const { cookie } = await signIn("cliente-u8@test.com", "customer");
		const res = await testRequest(adminApp, "/configurations/counts", {
			headers: { cookie },
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			success: false,
			error: "FORBIDDEN",
			message: "Accesso riservato agli amministratori",
		});
		const invalid = await testRequest(
			adminApp,
			"/holiday-definitions/preview?year=1999",
			{ headers: { cookie } },
		);
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "Valore non valido: deve essere almeno 2000",
		});
	});

	it("admin: 200", async () => {
		const { cookie } = await signIn("admin-u8@test.com", "admin");
		const res = await testRequest(adminApp, "/configurations/counts", {
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: {
				productCategories: 0,
				productMacroCategories: 0,
				storeCategories: 0,
				storeMacroCategories: 0,
				productCharacteristics: 0,
			},
		});
	});
});

describe("import CSV col FormData del client hc", () => {
	it("categorie prodotto e negozio, dizionario e matrice", async () => {
		const { cookie } = await signIn("admin-csv-u8@test.com", "admin");
		const api = client(cookie);

		const products = await api["product-categories"].import.$post({
			form: {
				file: csv(["macro_category,subcategory", "Elettronica,Smartphone"]),
			},
		});
		expect(products.status).toBe(200);
		expect(await products.json()).toEqual({
			success: true,
			data: { created: 2, skipped: 0, failed: 0, errors: [] },
		});

		const stores = await api["store-categories"].import.$post({
			form: { file: csv(["macro_category,name", "Ristorazione,Bar"]) },
		});
		expect(await stores.json()).toEqual({
			success: true,
			data: { created: 2, skipped: 0, failed: 0, errors: [] },
		});

		const dictionary = await api["product-characteristics"].import.$post({
			form: {
				file: csv(["name,data_type,unit,options", "Colore,enum,,Rosso|Blu"]),
			},
		});
		expect(await dictionary.json()).toEqual({
			success: true,
			data: { created: 1, updated: 0, failed: 0, errors: [] },
		});

		const matrix = await api["product-category-characteristics"].import.$post({
			form: {
				file: csv([
					"macro_category,subcategory,characteristic,required",
					"Elettronica,Smartphone,Colore,true",
				]),
			},
		});
		expect(await matrix.json()).toEqual({
			success: true,
			data: { created: 1, skipped: 0, failed: 0, errors: [], missing: [] },
		});
	});

	it("senza file: 422 «File: campo obbligatorio»", async () => {
		const { cookie } = await signIn("admin-nofile-u8@test.com", "admin");
		const res = await testRequest(
			adminApp,
			"/product-characteristics/import",
			json("POST", {}, cookie),
		);
		expect(res.status).toBe(422);
		expect(await res.json()).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "File: campo obbligatorio",
		});
	});
});

describe("scritture admin attraverso le route", () => {
	it("PATCH di una macro senza aliquota la riporta al 22% (default di prima)", async () => {
		const { cookie } = await signIn("admin-vat-u8@test.com", "admin");
		const api = client(cookie);
		const created = await api["product-macro-categories"].$post({
			json: { name: "Alimentari", suggestedVatRate: "10" },
		});
		const { data } = await created.json();
		const updated = await api["product-macro-categories"][
			":macroCategoryId"
		].$patch({
			param: { macroCategoryId: data.id },
			json: { name: "Alimentari e bevande" },
		});
		expect(await updated.json()).toMatchObject({
			success: true,
			data: { name: "Alimentari e bevande", suggestedVatRate: "22" },
		});
	});

	it("DELETE con corpo JSON (confirmAffected) e 404 dopo", async () => {
		const { cookie } = await signIn("admin-del-u8@test.com", "admin");
		const api = client(cookie);
		const created = await api["product-characteristics"].$post({
			json: { name: "Peso", dataType: "number", unit: "kg" },
		});
		const { data } = await created.json();
		const route = api["product-characteristics"][":characteristicId"];
		const param = { characteristicId: data.id };

		const removed = await route.$delete({
			param,
			json: { confirmAffected: 0 },
		});
		expect(await removed.json()).toEqual({
			success: true,
			data: null,
			message: "Caratteristica eliminata",
		});
		const again = await testRequest(
			adminApp,
			`/product-characteristics/${data.id}`,
			json("DELETE", { confirmAffected: 0 }, cookie),
		);
		expect(again.status).toBe(404);
		expect(await again.json()).toEqual({
			success: false,
			error: "NOT_FOUND",
			message: "Caratteristica non trovata",
		});
	});
});

describe("catalogo pubblico", () => {
	it("le quattro liste rispondono senza sessione", async () => {
		for (const app of [
			catalog.productMacroCategoriesApp,
			catalog.productCategoriesApp,
			catalog.storeMacroCategoriesApp,
			catalog.storeCategoriesApp,
		]) {
			const res = await testRequest(app, "/?limit=1");
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				success: true,
				data: [],
				pagination: { page: 1, limit: 1, total: 0 },
			});
		}
	});

	it("422 e 404 con l'inviluppo di sempre", async () => {
		const invalid = await testRequest(
			catalog.storeCategoriesApp,
			"/?limit=101",
		);
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "Valore non valido: deve essere al massimo 100",
		});
		const missing = await testRequest(catalog.productCategoriesApp, "/nope");
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({
			success: false,
			error: "NOT_FOUND",
			message: "Risorsa non trovata",
		});
	});
});
