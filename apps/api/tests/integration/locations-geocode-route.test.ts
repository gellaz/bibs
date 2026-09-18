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

// ── Lifecycle ─────────────────────────────────────────────────────────────────

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

// `@/lib/auth` costruisce l'adapter Drizzle all'import: va importato DENTRO il
// test, dopo il mock di `@/db`, altrimenti punta al pool reale (ECONNREFUSED).
let app: { handle: (request: Request) => Promise<Response> };

beforeAll(async () => {
	await setupTestContainer();
	const { Elysia } = await import("elysia");
	const { errorHandler } = await import("@/plugins/error-handler");
	const { locationsModule } = await import("@/modules/locations");
	app = new Elysia()
		.state("pino", noopPino)
		.use(errorHandler)
		.use(locationsModule);
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /locations/geocode", () => {
	it("requires authentication", async () => {
		const res = await app.handle(
			new Request("http://localhost/locations/geocode?q=via%20roma%2012"),
		);

		expect(res.status).toBe(401);
	});

	it("keeps the municipality list public", async () => {
		const res = await app.handle(
			new Request("http://localhost/locations/municipalities/all"),
		);

		expect(res.status).toBe(200);
	});
});
