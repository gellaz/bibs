// PROBE: Elysia 1.4.30 .mount() + Hono 4.13 + better-auth 1.7.12. Not shipped.
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

import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { eq } from "drizzle-orm";
import { Elysia, NotFoundError } from "elysia";
import { Hono } from "hono";
import { type ApplyGlobalResponse, hc } from "hono/client";
import { setCookie } from "hono/cookie";
import logixlysia from "logixlysia";
import { user as userTable } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { sellerProfile } from "@/db/schemas/seller";
import { isOriginAllowed } from "@/lib/cors";
import { ServiceError } from "@/lib/errors";
import { pinoOptions } from "@/lib/logger";
import { errorBody, ok } from "@/lib/responses";
import { truncateAll } from "../helpers/cleanup";

// ── Hono probe sub-app ─────────────────────────────────────────────────────────
function makeProbe() {
	return new Hono()
		.get("/", (c) => c.json({ path: c.req.path }))
		.get("/echo", (c) =>
			c.json({
				path: c.req.path,
				url: c.req.url,
				headers: Object.fromEntries(c.req.raw.headers),
			}),
		)
		.post("/json", async (c) => {
			const bodyUsedOnEntry = c.req.raw.bodyUsed;
			return c.json({ bodyUsedOnEntry, body: await c.req.json() });
		})
		.post("/multipart", async (c) => {
			const form = await c.req.parseBody();
			const file = form.file as File;
			return c.json({
				name: form.name,
				file: { name: file.name, size: file.size, type: file.type },
				bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
			});
		})
		.post("/raw", async (c) => c.json({ raw: await c.req.text() }))
		.get("/throw-service", () => {
			throw new ServiceError(403, "Vietato dal probe");
		})
		.get("/throw-plain", () => {
			throw new Error("boom");
		})
		.get("/cookie", (c) => {
			setCookie(c, "a", "1", { httpOnly: true, path: "/" });
			setCookie(c, "b", "2", { httpOnly: true, path: "/" });
			c.header("x-hono", "1");
			return c.json({ ok: true }, 201);
		});
}

const plain = makeProbe(); // Hono defaults for onError / notFound
const rethrow = makeProbe();
// strangler mode: let Elysia's global errorHandler format everything
rethrow.onError((err) => {
	throw err;
});
rethrow.notFound(() => {
	throw new NotFoundError();
});

// ── log capture through the real logixlysia ────────────────────────────────────
const logs: { level: string; path: string; status?: unknown }[] = [];
const captureTransport = {
	log: (level: string, _msg: string, meta?: Record<string, unknown>) => {
		const req = meta?.request as { url?: string } | undefined;
		logs.push({
			level,
			path: req?.url ? new URL(req.url).pathname : "",
			status: meta?.status,
		});
	},
};

let app: any;
let auth: any;
let authApp: Hono<any>;
let meApp: ReturnType<typeof makeMeApp>;
let H: typeof import("./hono-auth");

function makeMeApp(h: typeof import("./hono-auth")) {
	return new Hono<import("./hono-auth").AuthEnv>()
		.use(h.requireAuth)
		.get("/whoami", (c) =>
			c.json(ok({ id: c.var.user.id, role: c.var.user.role ?? null })),
		)
		.post("/echo-name", async (c) => {
			const body = await c.req.json<{ name: string }>();
			return c.json(ok({ name: body.name }), 201);
		});
}

beforeAll(async () => {
	await setupTestContainer();
	// dynamic: @/lib/auth captures `db` at evaluation (see memory note)
	({ auth } = await import("@/lib/auth"));
	const { OpenAPI } = await import("@/lib/auth");
	const { errorHandler } = await import("@/plugins/error-handler");
	const { requestId } = await import("@/plugins/request-id");
	const { normalize } = await import("@/plugins/normalize");
	const { betterAuth } = await import("@/plugins/better-auth");
	const { stripeWebhookRoutes } = await import("@/modules/webhooks");
	const { registration } = await import("@/modules/registration");
	const { adminModule } = await import("@/modules/admin");
	const { catalogModule } = await import("@/modules/catalog");
	const { locationsModule } = await import("@/modules/locations");
	const { sellerModule } = await import("@/modules/seller");
	const { customerModule } = await import("@/modules/customer");
	const { meModule } = await import("@/modules/me");
	const { health } = await import("@/plugins/health");
	H = await import("./hono-auth");

	// Hono twin of the guards, mounted in strangler mode (rethrow → Elysia)
	authApp = new Hono<any>()
		.get("/any", H.requireAuth, (c) => c.json(ok({ id: c.var.user.id })))
		.get("/admin", H.requireAuth, H.requireAdmin, (c) => c.json(ok("admin")))
		.get("/seller-role", H.requireAuth, H.requireSellerRole, (c) =>
			c.json(ok("seller-role")),
		)
		.get("/seller", H.requireAuth, H.requireSeller, (c) =>
			c.json(ok({ isOwner: c.var.seller.isOwner })),
		)
		.get("/customer", H.requireAuth, H.requireCustomer, (c) =>
			c.json(ok({ profileId: c.var.customerProfile.id })),
		);
	authApp.onError((err) => {
		throw err;
	});
	meApp = makeMeApp(H);
	meApp.onError((err) => {
		throw err;
	});

	// same chain as src/index.ts (minus cron, listen, ensureBucket)
	app = new Elysia()
		.use(
			logixlysia({
				config: {
					showStartupMessage: false,
					customLogFormat:
						"{now} {level} {duration} {method} {pathname} {status} {ip}",
					disableFileLogging: true,
					transports: [captureTransport as any],
					pino: pinoOptions,
				},
			}),
		)
		.use(
			cors({
				origin: (request) =>
					isOriginAllowed(request.headers.get("origin"), {
						nodeEnv: "development",
						allowedOrigins: undefined,
					}),
				methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
				credentials: true,
				allowedHeaders: ["Content-Type", "Authorization"],
				exposeHeaders: ["Content-Length", "X-Request-Id"],
				maxAge: 86400,
			}),
		)
		.use(errorHandler)
		.use(requestId)
		.use(normalize)
		.use(
			openapi({
				documentation: {
					info: { title: "bibs API", version: "1.0.0" },
					components: { ...(await OpenAPI.components) },
					paths: await OpenAPI.getPaths(),
				},
			}),
		)
		.use(stripeWebhookRoutes)
		.use(betterAuth)
		.use(registration)
		.use(adminModule)
		.use(catalogModule)
		.use(locationsModule)
		.use(sellerModule)
		.use(customerModule)
		// ← where a migrated module goes
		.mount("/zz-probe", plain.fetch)
		.mount("/zz-rethrow", rethrow.fetch)
		.mount("/zz-auth", authApp.fetch)
		.mount("/zz-me", meApp.fetch)
		.use(meModule)
		.use(health);
}, 180_000);

afterAll(async () => {
	await teardownTestContainer();
});

const req = (path: string, init?: RequestInit) =>
	app.handle(new Request(`http://localhost${path}`, init)) as Promise<Response>;

// ── 1. prefix + global behaviors ───────────────────────────────────────────────
describe("1. mount semantics", () => {
	it("strips the prefix: Hono sees /echo and / (same host/query)", async () => {
		const r = await req("/zz-probe/echo?x=1");
		const b = await r.json();
		expect(b.path).toBe("/echo");
		expect(b.url).toBe("http://localhost/echo?x=1");
		expect((await (await req("/zz-probe")).json()).path).toBe("/");
	});

	it("X-Request-Id: generated and echoed on mounted responses", async () => {
		const r1 = await req("/zz-probe/echo");
		expect(r1.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
		const r2 = await req("/zz-probe/echo", {
			headers: { "x-request-id": "edge-1" },
		});
		expect(r2.headers.get("x-request-id")).toBe("edge-1");
	});

	it("CORS: preflight answered by Elysia, headers on mounted responses", async () => {
		const pre = await req("/zz-probe/json", {
			method: "OPTIONS",
			headers: {
				origin: "http://localhost:3001",
				"access-control-request-method": "POST",
			},
		});
		expect(pre.status).toBe(204);
		expect(pre.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:3001",
		);
		expect(pre.headers.get("access-control-max-age")).toBe("86400");
		const r = await req("/zz-probe/echo", {
			headers: { origin: "http://localhost:3001" },
		});
		expect(r.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:3001",
		);
		expect(r.headers.get("access-control-allow-credentials")).toBe("true");
		expect(r.headers.get("access-control-expose-headers")).toContain(
			"X-Request-Id",
		);
		const bad = await req("/zz-probe/echo", {
			headers: { origin: "https://evil.example" },
		});
		expect(bad.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("Hono status, headers and multiple Set-Cookie survive", async () => {
		const r = await req("/zz-probe/cookie");
		expect(r.status).toBe(201);
		expect(r.headers.get("x-hono")).toBe("1");
		expect(r.headers.getSetCookie()).toEqual([
			"a=1; Path=/; HttpOnly",
			"b=2; Path=/; HttpOnly",
		]);
		expect(r.headers.get("x-request-id")).toBeTruthy();
	});

	it("logixlysia logs mounted requests with Hono's status", async () => {
		logs.length = 0;
		await req("/zz-probe/cookie");
		await req("/zz-probe/nope");
		await new Promise((r) => setTimeout(r, 50));
		console.log("PROBE logs", JSON.stringify(logs));
		expect(logs.some((l) => l.path === "/zz-probe/cookie")).toBe(true);
	});

	it("errors: Hono defaults bypass the envelope; rethrow reaches errorHandler", async () => {
		const a = await req("/zz-probe/throw-service");
		console.log(
			"PROBE plain throw",
			a.status,
			a.headers.get("content-type"),
			await a.text(),
		);
		const b = await req("/zz-rethrow/throw-service");
		expect(b.status).toBe(403);
		expect(await b.json()).toEqual(errorBody("FORBIDDEN", "Vietato dal probe"));
		const c = await req("/zz-rethrow/throw-plain");
		expect(c.status).toBe(500);
		expect(await c.json()).toEqual(
			errorBody("INTERNAL_ERROR", "Errore interno del server"),
		);
		expect(b.headers.get("x-request-id")).toBeTruthy();
	});

	it("404 inside the prefix: Hono notFound vs rethrown NotFoundError", async () => {
		const a = await req("/zz-probe/nope");
		console.log(
			"PROBE plain 404",
			a.status,
			a.headers.get("content-type"),
			await a.text(),
		);
		const b = await req("/zz-rethrow/nope");
		expect(b.status).toBe(404);
		expect(await b.json()).toEqual(
			errorBody("NOT_FOUND", "Risorsa non trovata"),
		);
		// method not registered in Hono → also Hono 404, never Elysia 405
		const m = await req("/zz-rethrow/echo", { method: "DELETE" });
		expect(m.status).toBe(404);
	});

	it("mounted routes are hidden from /openapi/json", async () => {
		const r = await req("/openapi/json");
		const spec = await r.json();
		const paths = Object.keys(spec.paths);
		expect(paths.some((p) => p.startsWith("/zz-"))).toBe(false);
		expect(paths).toContain("/me/avatar");
	});
});

// ── 2. bodies ──────────────────────────────────────────────────────────────────
describe("2. request body", () => {
	it("JSON reaches Hono unread and NOT trimmed by normalize", async () => {
		const r = await req("/zz-probe/json", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "  x  ", password: " p " }),
		});
		expect(await r.json()).toEqual({
			bodyUsedOnEntry: false,
			body: { name: "  x  ", password: " p " },
		});
	});

	it("multipart: file bytes and untrimmed fields intact", async () => {
		const fd = new FormData();
		fd.append("name", "  y  ");
		fd.append(
			"file",
			new File([new Uint8Array([0, 1, 2, 255])], "a.png", {
				type: "image/png",
			}),
		);
		const r = await req("/zz-probe/multipart", { method: "POST", body: fd });
		expect(await r.json()).toEqual({
			name: "  y  ",
			file: { name: "a.png", size: 4, type: "image/png" },
			bytes: [0, 1, 2, 255],
		});
	});

	it("raw body byte-identical (Stripe signature)", async () => {
		const raw = '{ "id":"evt_1",\n  "type" : "x" }';
		const r = await req("/zz-probe/raw", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: raw,
		});
		expect((await r.json()).raw).toBe(raw);
	});
});

// ── 3. better-auth guards: Elysia today vs Hono prototype ──────────────────────
describe("3. auth middleware parity", () => {
	const cookies: Record<string, string> = {};

	async function signUpAndIn(email: string, role: string) {
		await auth.api.signUpEmail({
			body: { name: email.split("@")[0], email, password: "password123" },
		});
		await getTestDb()
			.update(userTable)
			.set({ emailVerified: true, role })
			.where(eq(userTable.email, email));
		// native endpoint through the real Elysia mount
		const r = await req("/auth/api/sign-in/email", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://localhost:3001",
			},
			body: JSON.stringify({ email, password: "password123" }),
		});
		expect(r.status).toBe(200);
		const [row] = await getTestDb()
			.select()
			.from(userTable)
			.where(eq(userTable.email, email));
		return {
			id: row.id,
			cookie: r.headers
				.getSetCookie()
				.map((c) => c.split(";")[0])
				.join("; "),
		};
	}

	beforeAll(async () => {
		await truncateAll(getTestDb());
		const cust = await signUpAndIn("cust@test.com", "customer");
		await getTestDb().insert(customerProfile).values({ userId: cust.id });
		const sell = await signUpAndIn("sell@test.com", "seller");
		await getTestDb()
			.insert(sellerProfile)
			.values({ userId: sell.id, onboardingStatus: "pending_review" });
		const adm = await signUpAndIn("adm@test.com", "admin");
		cookies.customer = cust.cookie;
		cookies.seller = sell.cookie;
		cookies.admin = adm.cookie;
	}, 60_000);

	const both = async (elysiaPath: string, honoPath: string, who?: string) => {
		const headers = who ? { cookie: cookies[who] } : undefined;
		const e = await req(elysiaPath, { headers });
		const h = await req(honoPath, { headers });
		return {
			e: { status: e.status, body: await e.json() },
			h: { status: h.status, body: await h.json() },
		};
	};

	it("401 without session: identical body", async () => {
		const { e, h } = await both("/admin/requests/counts", "/zz-auth/any");
		expect(e.status).toBe(401);
		expect(h).toEqual(e);
	});

	it("403 admin guard: identical body", async () => {
		const { e, h } = await both(
			"/admin/requests/counts",
			"/zz-auth/admin",
			"customer",
		);
		expect(e.status).toBe(403);
		expect(h).toEqual(e);
		expect(
			(await req("/zz-auth/admin", { headers: { cookie: cookies.admin } }))
				.status,
		).toBe(200);
	});

	it("403 seller role guard: identical body", async () => {
		const { e, h } = await both(
			"/seller/profile",
			"/zz-auth/seller-role",
			"customer",
		);
		expect(e.status).toBe(403);
		expect(h).toEqual(e);
	});

	it("403 seller access (onboarding not active): identical body", async () => {
		const { e, h } = await both(
			"/seller/dashboard?storeId=x",
			"/zz-auth/seller",
			"seller",
		);
		expect(e.status).toBe(403);
		expect(h).toEqual(e);
	});

	it("403 customer profile guard + 200 with profile", async () => {
		const { e, h } = await both(
			"/customer/profile",
			"/zz-auth/customer",
			"admin",
		);
		expect(e.status).toBe(403);
		expect(h).toEqual(e);
		const ok200 = await req("/zz-auth/customer", {
			headers: { cookie: cookies.customer },
		});
		expect(ok200.status).toBe(200);
	});

	it("ORDER: Elysia validates the query BEFORE the auth resolve", async () => {
		const e = await req("/seller/dashboard"); // no cookie, missing storeId
		console.log(
			"PROBE elysia no-cookie + invalid query",
			e.status,
			await e.text(),
		);
	});

	it("Bearer token (bearerAuth in OpenAPI) is NOT accepted today either", async () => {
		const s = await auth.api.signInEmail({
			body: { email: "adm@test.com", password: "password123" },
		});
		const e = await req("/admin/requests/counts", {
			headers: { authorization: `Bearer ${s.token}` },
		});
		const h = await req("/zz-auth/admin", {
			headers: { authorization: `Bearer ${s.token}` },
		});
		console.log("PROBE bearer", e.status, h.status);
		expect(h.status).toBe(e.status);
	});
});

// ── 4. better-auth handler on Hono + XFF overwrite on a real socket ─────────────
describe("4. better-auth mount + x-forwarded-for", () => {
	it("Elysia today: XFF overwritten for mounted Hono requests too", async () => {
		app.listen(0);
		const base = `http://localhost:${app.server.port}`;
		const r = await fetch(`${base}/zz-probe/echo`, {
			headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" },
		});
		const b = await r.json();
		console.log("PROBE elysia socket xff", b.headers["x-forwarded-for"]);
		expect(b.headers["x-forwarded-for"]).not.toBe("6.6.6.6");
		expect(b.headers["x-real-ip"]).toBeUndefined();
		await app.stop();
	});

	it("Hono twin: same overwrite, better-auth limiter keyed on socket IP", async () => {
		const honoRoot = new Hono()
			.use(H.socketIpAsForwardedFor)
			.get("/zz/echo", (c) =>
				c.json({
					xff: c.req.header("x-forwarded-for") ?? null,
					xri: c.req.header("x-real-ip") ?? null,
				}),
			)
			.all("/auth/*", H.betterAuthHandler);
		const server = Bun.serve({ port: 0, fetch: honoRoot.fetch });
		const base = `http://localhost:${server.port}`;
		const e = await (
			await fetch(`${base}/zz/echo`, {
				headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" },
			})
		).json();
		expect(e.xff).not.toBe("6.6.6.6");
		expect(e.xri).toBeNull();
		// /request-password-reset: max 5/h. Rotate the spoofed XFF every call.
		const statuses: number[] = [];
		for (let i = 0; i < 6; i++) {
			const r = await fetch(`${base}/auth/api/request-password-reset`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:3001",
					"x-forwarded-for": `10.0.0.${i}`,
				},
				body: JSON.stringify({
					email: "nobody@test.com",
					redirectTo: "http://localhost:3001/r",
				}),
			});
			statuses.push(r.status);
		}
		console.log("PROBE hono rate-limit statuses", statuses);
		expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
		expect(statuses[5]).toBe(429);
		// sign-in through the Hono mount works and returns the session cookie
		const si = await fetch(`${base}/auth/api/sign-in/email`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://localhost:3001",
			},
			body: JSON.stringify({ email: "adm@test.com", password: "password123" }),
		});
		expect(si.status).toBe(200);
		const cookie = si.headers
			.getSetCookie()
			.map((c) => c.split(";")[0])
			.join("; ");
		const gs = await fetch(`${base}/auth/api/get-session`, {
			headers: { cookie },
		});
		expect((await gs.json()).user.email).toBe("adm@test.com");
		server.stop(true);
	});
});

// ── 5. hc typed for the sub-tree only ──────────────────────────────────────────
describe("5. hc client on a sub-app", () => {
	it("hc<MeApp>(base + '/zz-me') with credentials: include", async () => {
		app.listen(0);
		const base = `http://localhost:${app.server.port}`;
		const email = "hc@test.com";
		await auth.api.signUpEmail({
			body: { name: "hc", email, password: "password123" },
		});
		await getTestDb()
			.update(userTable)
			.set({ emailVerified: true, role: "customer" })
			.where(eq(userTable.email, email));
		const si = await fetch(`${base}/auth/api/sign-in/email`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://localhost:3001",
			},
			body: JSON.stringify({ email, password: "password123" }),
		});
		const cookie = si.headers
			.getSetCookie()
			.map((c) => c.split(";")[0])
			.join("; ");

		type MeApp = typeof meApp;
		const client = hc<MeApp>(`${base}/zz-me`, {
			init: { credentials: "include" },
			headers: { cookie }, // Bun has no cookie jar; the browser sends it itself
		});
		const r = await client.whoami.$get();
		expect(r.status).toBe(200);
		if (r.ok) {
			const body = await r.json();
			expect(body.data.role).toBe("customer"); // typed: string | null
		}
		const p = await client["echo-name"].$post({
			json: { name: "  z " },
		} as any);
		expect(p.status).toBe(201);
		// thrown ServiceErrors are invisible to hc's types: declare the envelope once
		type ErrorBody = ReturnType<typeof errorBody>;
		type MeClientApp = ApplyGlobalResponse<
			MeApp,
			{
				401: { json: ErrorBody };
				403: { json: ErrorBody };
				422: { json: ErrorBody };
				500: { json: ErrorBody };
			}
		>;
		const anon = await hc<MeClientApp>(`${base}/zz-me`).whoami.$get();
		expect(anon.status).toBe(401);
		if (anon.status === 401) {
			const e = await anon.json(); // typed ErrorBody
			expect(e).toEqual(
				errorBody("UNAUTHORIZED", "Devi accedere per continuare"),
			);
		}
		await app.stop();
	});
});

// ── extra: which Elysia lifecycle hooks fire for a mounted route ───────────────
describe("1b. lifecycle hooks on a mounted route", () => {
	it("records the global hooks", async () => {
		const seen: string[] = [];
		const tiny = new Hono().post("/x", async (c) =>
			c.json({ got: await c.req.json() }),
		);
		// NB: a global onParse here turns the mounted POST into Elysia's 400
		// "Bad Request" (seen in run2: onRequest > onParse > onAfterResponse).
		const e = new Elysia()
			.onRequest(() => {
				seen.push("onRequest");
			})
			.onTransform({ as: "global" }, () => {
				seen.push("onTransform");
			})
			.derive({ as: "global" }, () => {
				seen.push("derive");
				return {};
			})
			.resolve({ as: "global" }, () => {
				seen.push("resolve");
				return {};
			})
			.onBeforeHandle({ as: "global" }, () => {
				seen.push("onBeforeHandle");
			})
			.onAfterHandle({ as: "global" }, ({ responseValue }) => {
				seen.push(`onAfterHandle:${responseValue instanceof Response}`);
			})
			.mapResponse({ as: "global" }, () => {
				seen.push("mapResponse");
			})
			.onAfterResponse({ as: "global" }, () => {
				seen.push("onAfterResponse");
			})
			.mount("/m", tiny.fetch);
		const r = await e.handle(
			new Request("http://localhost/m/x", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"a":" 1 "}',
			}),
		);
		await new Promise((res) => setTimeout(res, 20));
		console.log("PROBE lifecycle", seen.join(" > "), await r.text());
	});
});

// ── extra: end-state Hono onError gives the same envelope without Elysia ───────
describe("3b. standalone Hono error envelope", () => {
	it("ServiceError → identical body, 404 → identical body", async () => {
		const standalone = new Hono<import("./hono-auth").AuthEnv>().get(
			"/admin",
			H.requireAuth,
			H.requireAdmin,
			(c) => c.json(ok("x")),
		);
		standalone.onError((err, c) =>
			err instanceof ServiceError
				? c.json(errorBody(err.code, err.message), err.status)
				: c.json(errorBody("INTERNAL_ERROR", "Errore interno del server"), 500),
		);
		standalone.notFound((c) =>
			c.json(errorBody("NOT_FOUND", "Risorsa non trovata"), 404),
		);
		const a = await standalone.request("/admin");
		const b = await req("/admin/requests/counts");
		expect({ s: a.status, b: await a.json() }).toEqual({
			s: b.status,
			b: await b.json(),
		});
		const n = await standalone.request("/nope");
		const m = await req("/nope");
		expect({ s: n.status, b: await n.json() }).toEqual({
			s: m.status,
			b: await m.json(),
		});
	});
});

// ── extra: negative control — without the overwrite, spoofed XFF dodges the limiter
describe("4b. negative control", () => {
	it("no overwrite → rotating XFF never hits 429", async () => {
		const naked = new Hono().all("/auth/*", H.betterAuthHandler);
		const server = Bun.serve({ port: 0, fetch: naked.fetch });
		const statuses: number[] = [];
		for (let i = 0; i < 7; i++) {
			const r = await fetch(
				`http://localhost:${server.port}/auth/api/send-verification-email`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "http://localhost:3001",
						"x-forwarded-for": `10.9.9.${i}`,
					},
					body: JSON.stringify({ email: "nobody2@test.com" }),
				},
			);
			statuses.push(r.status);
		}
		console.log("PROBE naked statuses", statuses);
		expect(statuses.includes(429)).toBe(false);
		server.stop(true);
	});
});
