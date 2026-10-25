import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

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

import { testRequest } from "../helpers/hono-app";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// `@/lib/auth` costruisce l'adapter Drizzle all'import: va importato DENTRO il
// test, dopo il mock di `@/db`, altrimenti punta al pool reale (ECONNREFUSED).
let app: typeof import("@/modules/locations").locationsApp;

beforeAll(async () => {
	await setupTestContainer();
	({ locationsApp: app } = await import("@/modules/locations"));
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /locations/geocode", () => {
	it("requires authentication", async () => {
		// Montata su /locations: il mount toglie il prefisso.
		const res = await testRequest(app, "/geocode?q=via%20roma%2012");

		expect(res.status).toBe(401);
	});

	it("keeps the municipality list public", async () => {
		const res = await testRequest(app, "/municipalities/all");

		expect(res.status).toBe(200);
	});
});
