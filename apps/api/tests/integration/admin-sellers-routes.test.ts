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

import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { sellerProfile } from "@/db/schemas/seller";
import { truncateAll } from "../helpers/cleanup";
import { createTestOrganization, createTestSeller } from "../helpers/fixtures";
import { signIn, testRequest } from "../helpers/hono-app";

// Le route admin di U9 sulla sub-app Hono con sessioni better-auth vere:
// guardia admin dopo la validazione (422 prima di 401/403), moderazione con
// `expectedUpdatedAt` preso dalla lista come fa il FE (stringa ISO, niente
// `Date` del client di prima) e 409 ottimistico, indice `/requests/` con e
// senza slash. Attesi catturati prima della migrazione
// (`baseline/hono-batch-admin-2.jsonl`).

let adminApp: typeof import("@/modules/admin").adminApp;

beforeAll(async () => {
	await setupTestContainer();
	// dinamico: @/lib/auth cattura `db` alla valutazione
	({ adminApp } = await import("@/modules/admin"));
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

async function pendingSeller(email: string) {
	const db = getTestDb();
	const seller = await createTestSeller(db, { email });
	await db
		.update(sellerProfile)
		.set({ onboardingStatus: "pending_review" })
		.where(eq(sellerProfile.id, seller.profile.id));
	await createTestOrganization(db, seller.profile.id);
	return seller.profile.id;
}

const stale = "2026-01-01T00:00:00.000Z";

describe("requireAdmin dopo i validatori", () => {
	it("anonimo: 422 se l'input non è valido, altrimenti 401", async () => {
		const invalid = await testRequest(
			adminApp,
			"/sellers/x/verify",
			json("PATCH", {}),
		);
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "expectedUpdatedAt: campo obbligatorio",
		});
		const res = await testRequest(
			adminApp,
			"/sellers/x/verify",
			json("PATCH", { expectedUpdatedAt: stale }),
		);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			success: false,
			error: "UNAUTHORIZED",
			message: "Devi accedere per continuare",
		});
	});

	it("utente non admin: 403, sempre dopo la validazione", async () => {
		const { cookie } = await signIn("cliente-u9@test.com", "customer");
		const res = await testRequest(adminApp, "/requests/counts", {
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
			"/sellers/x/reject",
			json("PATCH", {}, cookie),
		);
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "fixStep: campo obbligatorio",
		});
	});
});

describe("moderazione dal client hc", () => {
	it("verifica con l'updatedAt della lista; versione vecchia o già decisa → 409", async () => {
		const sellerId = await pendingSeller("candidato-u9@test.com");
		const { cookie } = await signIn("admin-u9@test.com", "admin");
		const api = client(cookie);

		const list = await api.sellers.$get({
			query: { status: "pending_review" },
		});
		expect(list.status).toBe(200);
		const { data } = await list.json();
		expect(data.map((s) => s.id)).toEqual([sellerId]);
		const updatedAt = data[0].updatedAt;
		expect(typeof updatedAt).toBe("string");

		const verify = (expectedUpdatedAt: string) =>
			testRequest(
				adminApp,
				`/sellers/${sellerId}/verify`,
				json("PATCH", { expectedUpdatedAt }, cookie),
			);
		const old = await verify(stale);
		expect(old.status).toBe(409);
		expect(await old.json()).toEqual({
			success: false,
			error: "CONFLICT",
			message:
				"Il venditore ha aggiornato la candidatura: ricontrolla i dati prima di decidere",
		});

		// Come il FE: la stringa della lista, riconvertita in Date.
		const res = await api.sellers[":sellerId"].verify.$patch({
			param: { sellerId },
			json: { expectedUpdatedAt: new Date(updatedAt) },
		});
		expect(res.status).toBe(200);
		const verified = await res.json();
		expect(verified.data.onboardingStatus).toBe("active");

		const again = await verify(updatedAt);
		expect(again.status).toBe(409);
		expect(await again.json()).toEqual({
			success: false,
			error: "CONFLICT",
			message: "La candidatura è già stata decisa",
		});
	});

	it("rifiuto con step da correggere: motivo trimmato", async () => {
		const sellerId = await pendingSeller("rifiutato-u9@test.com");
		const { cookie } = await signIn("admin2-u9@test.com", "admin");
		const api = client(cookie);
		const detail = await (
			await api.sellers[":sellerId"].$get({ param: { sellerId } })
		).json();

		const res = await api.sellers[":sellerId"].reject.$patch({
			param: { sellerId },
			json: {
				reason: " Documento illeggibile ",
				fixStep: "document",
				expectedUpdatedAt: detail.data.updatedAt,
			},
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.onboardingStatus).toBe("pending_document");
		expect(body.data.rejectionReason).toBe("Documento illeggibile");
	});
});

describe("richieste", () => {
	it("l'indice risponde con e senza slash finale, come prima", async () => {
		await pendingSeller("richiesta-u9@test.com");
		const { cookie } = await signIn("admin3-u9@test.com", "admin");
		for (const path of ["/requests", "/requests/"]) {
			const res = await testRequest(adminApp, `${path}?limit=1`, {
				headers: { cookie },
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.pagination).toEqual({ page: 1, limit: 1, total: 1 });
			expect(body.data[0].kind).toBe("candidature");
		}
	});
});
