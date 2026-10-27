import { beforeEach, describe, expect, it, mock } from "bun:test";
import { withVars } from "../../../helpers/hono-app";

// Strip del modulo admin e del catalogo su Hono (trappola `normalize`, D4 del
// piano Hono): i campi ignoti, anche annidati, non arrivano al servizio e le
// colonne in più restituite dal servizio non escono nella risposta. Servizi
// finti, utente admin già risolto (`withVars`): niente DB.

const calls: unknown[] = [];
const createdAt = new Date("2026-01-02T03:04:05.000Z");
const characteristic = {
	id: "c1",
	name: "Colore",
	dataType: "enum",
	unit: null,
	createdAt,
	updatedAt: createdAt,
	internalNote: "colonna interna",
};

mock.module("@/modules/admin/services/product-characteristics", () => ({
	normalizeDefinition: () => ({}),
	listProductCharacteristics: async (query: unknown) => {
		calls.push(query);
		return {
			data: [
				{
					...characteristic,
					valueCount: 2,
					options: [
						{
							id: "o1",
							value: "Rosso",
							sortOrder: 0,
							valueCount: 2,
							secret: 1,
						},
					],
				},
			],
			pagination: { page: 1, limit: 5, total: 1, offset: 0 },
		};
	},
	createProductCharacteristic: async (body: unknown) => {
		calls.push(body);
		return characteristic;
	},
	updateProductCharacteristic: async () => ({}),
	deleteProductCharacteristic: async () => ({}),
}));

mock.module("@/modules/catalog/services/product-categories", () => ({
	listProductCategories: async (query: unknown) => {
		calls.push(query);
		return {
			data: [
				{
					id: "pc1",
					macroCategoryId: "m1",
					name: "Pane",
					createdAt,
					updatedAt: createdAt,
					sellerId: "interno",
					macroCategory: {
						id: "m1",
						name: "Alimentari",
						suggestedVatRate: "10",
						createdAt,
						updatedAt: createdAt,
						internal: true,
					},
				},
			],
			pagination: { page: 1, limit: 20, total: 1 },
		};
	},
}));

const { adminApp } = await import("@/modules/admin");
const { productCategoriesApp } = await import("@/modules/catalog");
const admin = withVars(adminApp, { user: { id: "admin-1", role: "admin" } });

const iso = createdAt.toISOString();

beforeEach(() => {
	calls.length = 0;
});

describe("admin su Hono: strip in ingresso", () => {
	it("body: i campi ignoti, anche dentro le opzioni, non arrivano al servizio", async () => {
		const res = await admin.request("/product-characteristics", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: " Colore ",
				dataType: "enum",
				options: [{ value: "Rosso", secret: 1 }],
				ownerId: "someone-else",
			}),
		});
		expect(res.status).toBe(200);
		expect(calls).toEqual([
			{ name: "Colore", dataType: "enum", options: [{ value: "Rosso" }] },
		]);
	});

	it("query: i parametri ignoti non arrivano al servizio, i default sì", async () => {
		const res = await admin.request(
			"/product-characteristics?limit=5&ownerId=x",
		);
		expect(res.status).toBe(200);
		expect(calls).toEqual([
			{ page: 1, limit: 5, sortBy: "name", sortOrder: "asc" },
		]);
	});
});

describe("admin e catalogo su Hono: strip in uscita", () => {
	it("le colonne in più del servizio non escono, nemmeno annidate", async () => {
		const res = await admin.request("/product-characteristics?limit=5");
		expect(await res.text()).toBe(
			JSON.stringify({
				success: true,
				data: [
					{
						id: "c1",
						name: "Colore",
						dataType: "enum",
						unit: null,
						createdAt: iso,
						updatedAt: iso,
						valueCount: 2,
						options: [
							{ id: "o1", value: "Rosso", sortOrder: 0, valueCount: 2 },
						],
					},
				],
				pagination: { page: 1, limit: 5, total: 1 },
			}),
		);
	});

	it("risposta di una creazione: solo i campi dello schema", async () => {
		const res = await admin.request("/product-characteristics", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Colore", dataType: "enum" }),
		});
		expect(await res.json()).toEqual({
			success: true,
			data: {
				id: "c1",
				name: "Colore",
				dataType: "enum",
				unit: null,
				createdAt: iso,
				updatedAt: iso,
			},
		});
	});

	it("catalogo pubblico: la macro annidata perde i campi interni", async () => {
		const res = await productCategoriesApp.request("/?foo=1");
		expect(calls).toEqual([
			{ page: 1, limit: 20, sortBy: "name", sortOrder: "asc" },
		]);
		expect(await res.json()).toEqual({
			success: true,
			data: [
				{
					id: "pc1",
					macroCategoryId: "m1",
					name: "Pane",
					createdAt: iso,
					updatedAt: iso,
					macroCategory: {
						id: "m1",
						name: "Alimentari",
						suggestedVatRate: "10",
						createdAt: iso,
						updatedAt: iso,
					},
				},
			],
			pagination: { page: 1, limit: 20, total: 1 },
		});
	});
});
