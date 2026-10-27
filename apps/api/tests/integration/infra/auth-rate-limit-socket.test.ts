import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

mock.module("@/infra/email", () => ({ sendEmail: async () => {} }));

// U11 del piano Hono: la difesa contro l'aggiramento del rate limit di
// better-auth. Su un `Bun.serve` vero `socketIpAsForwardedFor` sovrascrive
// x-forwarded-for con l'IP del socket, quindi cinque x-forwarded-for diversi
// finiscono nello stesso bucket (`/request-password-reset`: 5 l'ora, poi 429).
// Controllo negativo: senza il middleware gli stessi header aprono ogni volta
// un bucket nuovo e il limite non scatta mai. App e better-auth si importano
// dopo `mock.module("@/db")`.

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

async function statuses(fetchHandler: (request: Request, server: any) => any) {
	const server = Bun.serve({ port: 0, fetch: fetchHandler });
	try {
		const out: number[] = [];
		for (let i = 1; i <= 6; i++) {
			const res = await fetch(
				`http://localhost:${server.port}/auth/api/request-password-reset`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-forwarded-for": `10.0.0.${i}`,
						"x-real-ip": `10.9.9.${i}`,
					},
					body: JSON.stringify({
						email: "collaudo.hono.u11@test.com",
						redirectTo: "http://localhost:3001/reset-password",
					}),
				},
			);
			out.push(res.status);
		}
		return out;
	} finally {
		await server.stop(true);
	}
}

describe("better-auth: rate limit sull'IP del socket", () => {
	it("controllo negativo: senza il middleware x-forwarded-for falsificati non si fermano", async () => {
		const { Hono } = await import("hono");
		const { authHandler } = await import("@/http/middleware/better-auth");
		const bare = new Hono().all("/auth/*", authHandler);
		expect(await statuses(bare.fetch)).toEqual([200, 200, 200, 200, 200, 200]);
	});

	it("app radice: cinque x-forwarded-for diversi, poi 429", async () => {
		const { app } = await import("@/app");
		expect(await statuses(app.fetch)).toEqual([200, 200, 200, 200, 200, 429]);
	});
});
