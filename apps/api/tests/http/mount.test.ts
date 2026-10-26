import { afterAll, describe, expect, it } from "bun:test";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { mount } from "hono/mount";
import logixlysia from "logixlysia";
import { moduleApp } from "@/http/app";
import { auth } from "@/lib/auth";
import { isOriginAllowed } from "@/lib/cors";
import { ServiceError } from "@/lib/errors";
import { pinoOptions } from "@/lib/logger";
import { errorBody } from "@/lib/responses";
import { meApp } from "@/modules/me";
import { sellerApp, sellerModule } from "@/modules/seller";
import { betterAuth } from "@/plugins/better-auth";
import { errorHandler } from "@/plugins/error-handler";
import { normalize } from "@/plugins/normalize";
import { requestId } from "@/plugins/request-id";
import { noopPino } from "./parity-cases";

// La rete dello strangler (D8 del piano Hono, `notes/probe-mount.md`): cosa
// Elysia continua a dare alle sub-app Hono montate con `.mount(prefisso,
// app.fetch)` e cosa fa la sub-app da sola. Stessa catena di plugin di
// `src/index.ts` (senza openapi, cron, listen).

const probe = () =>
	new Hono()
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
			const form = await c.req.formData();
			const file = form.get("file") as File;
			return c.json({
				name: form.get("name"),
				file: { name: file.name, size: file.size, type: file.type },
				bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
			});
		})
		.post("/raw", async (c) => c.json({ raw: await c.req.text() }))
		.get("/cookie", (c) => {
			setCookie(c, "a", "1", { httpOnly: true, path: "/" });
			setCookie(c, "b", "2", { httpOnly: true, path: "/" });
			c.header("x-hono", "1");
			return c.json({ ok: true }, 201);
		})
		.get("/throw", () => {
			throw new ServiceError(403, "Vietato");
		});

const plain = probe(); // senza la fabbrica del kit
const kit = moduleApp().route("/", probe());

const logs: { path: string; status?: unknown }[] = [];
const captureTransport = {
	log: (_level: string, _msg: string, meta?: Record<string, unknown>) => {
		const request = meta?.request as { url?: string } | undefined;
		logs.push({
			path: request?.url ? new URL(request.url).pathname : "",
			status: meta?.status,
		});
	},
};

const app = new Elysia()
	.use(
		logixlysia({
			config: {
				showStartupMessage: false,
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
					nodeEnv: "test",
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
	.use(betterAuth)
	// Una route Elysia sotto lo stesso prefisso vince sul mount.
	.get("/zz-kit/echo", () => ({ from: "elysia" }))
	.mount("/zz-plain", plain.fetch)
	.mount("/zz-kit", kit.fetch)
	.mount("/me", meApp.fetch);

afterAll(async () => {
	if (app.server) await app.stop();
});

const req = (path: string, init?: RequestInit) =>
	app.handle(new Request(`http://localhost${path}`, init));

const ORIGIN = { origin: "http://localhost:3001" };

describe("mount — prefisso e precedenza", () => {
	it("toglie il prefisso: Hono vede /echo, con host e query", async () => {
		const body = await (await req("/zz-plain/echo?x=1")).json();
		expect(body.path).toBe("/echo");
		expect(body.url).toBe("http://localhost/echo?x=1");
	});

	it("una route Elysia vince sul mount, le altre arrivano a Hono", async () => {
		expect(await (await req("/zz-kit/echo")).json()).toEqual({
			from: "elysia",
		});
		expect((await (await req("/zz-plain/echo")).json()).path).toBe("/echo");
	});
});

describe("mount — cosa resta a Elysia", () => {
	it("preflight CORS risposto da Elysia", async () => {
		const res = await req("/me/avatar", {
			method: "OPTIONS",
			headers: { ...ORIGIN, "access-control-request-method": "POST" },
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN.origin);
		expect(res.headers.get("access-control-max-age")).toBe("86400");
	});

	it("header CORS e x-request-id sulle risposte montate", async () => {
		const res = await req("/zz-plain/echo", { headers: ORIGIN });
		expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN.origin);
		expect(res.headers.get("access-control-allow-credentials")).toBe("true");
		expect(res.headers.get("access-control-expose-headers")).toBe(
			"Content-Length, X-Request-Id",
		);
		expect(res.headers.get("vary")).toBe("Origin");
		expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
		const echoed = await req("/zz-plain/echo", {
			headers: { "x-request-id": "edge-1" },
		});
		expect(echoed.headers.get("x-request-id")).toBe("edge-1");
	});

	it("status, header e Set-Cookie multipli di Hono passano", async () => {
		const res = await req("/zz-plain/cookie");
		expect(res.status).toBe(201);
		expect(res.headers.get("x-hono")).toBe("1");
		expect(res.headers.getSetCookie()).toEqual([
			"a=1; Path=/; HttpOnly",
			"b=2; Path=/; HttpOnly",
		]);
	});

	it("logixlysia registra la richiesta montata con lo status di Hono", async () => {
		logs.length = 0;
		await req("/zz-plain/cookie");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(logs).toContainEqual({ path: "/zz-plain/cookie", status: 201 });
	});

	it("x-forwarded-for sovrascritto con l'IP del socket anche per Hono", async () => {
		app.listen(0);
		const res = await fetch(
			`http://localhost:${app.server?.port}/zz-plain/echo`,
			{
				headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" },
			},
		);
		const { headers } = await res.json();
		expect(headers["x-forwarded-for"]).not.toBe("6.6.6.6");
		expect(headers["x-forwarded-for"]).toBeTruthy();
		expect(headers["x-real-ip"]).toBeUndefined();
		await app.stop();
	});
});

describe("mount — il body arriva intatto", () => {
	it("JSON non letto da Elysia e non trimmato da normalize", async () => {
		const res = await req("/zz-plain/json", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "  x  ", password: " p " }),
		});
		expect(await res.json()).toEqual({
			bodyUsedOnEntry: false,
			body: { name: "  x  ", password: " p " },
		});
	});

	it("multipart: byte del file e campi intatti", async () => {
		const form = new FormData();
		form.append("name", "  y  ");
		form.append(
			"file",
			new File([new Uint8Array([0, 1, 2, 255])], "a.png", {
				type: "image/png",
			}),
		);
		const res = await req("/zz-plain/multipart", {
			method: "POST",
			body: form,
		});
		expect(await res.json()).toEqual({
			name: "  y  ",
			file: { name: "a.png", size: 4, type: "image/png" },
			bytes: [0, 1, 2, 255],
		});
	});

	it("testo grezzo identico al byte (firma Stripe)", async () => {
		const raw = '{ "id":"evt_1",\n  "type" : "x" }';
		const res = await req("/zz-plain/raw", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: raw,
		});
		expect((await res.json()).raw).toBe(raw);
	});
});

describe("mount — errori: li formatta la sub-app, non Elysia", () => {
	it("senza la fabbrica del kit Hono risponde text/plain", async () => {
		const res = await req("/zz-plain/throw");
		expect(res.status).toBe(500);
		expect(res.headers.get("content-type")).toStartWith("text/plain");
		const notFound = await req("/zz-plain/nope");
		expect(notFound.status).toBe(404);
		expect(await notFound.text()).toBe("404 Not Found");
	});

	it("con moduleApp(): inviluppo JSON, Content-Type di Elysia, x-request-id", async () => {
		const res = await req("/zz-kit/throw");
		expect(res.status).toBe(403);
		expect(res.headers.get("content-type")).toBe(
			"application/json;charset=utf-8",
		);
		expect(res.headers.get("x-request-id")).toBeTruthy();
		expect(await res.json()).toEqual(errorBody("FORBIDDEN", "Vietato"));
		const notFound = await req("/zz-kit/nope", { method: "DELETE" });
		expect(notFound.status).toBe(404);
		expect(await notFound.json()).toEqual(
			errorBody("NOT_FOUND", "Risorsa non trovata"),
		);
	});

	it("slash finale tollerato (strict: false)", async () => {
		const res = await req("/me/avatar/", { method: "DELETE" });
		expect(res.status).toBe(401);
	});

	it("/me vero: 401 con gli header della baseline", async () => {
		const res = await req("/me/avatar", { method: "DELETE", headers: ORIGIN });
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual(
			errorBody("UNAUTHORIZED", "Devi accedere per continuare"),
		);
		expect(Object.fromEntries(res.headers)).toMatchObject({
			"access-control-allow-credentials": "true",
			"access-control-allow-headers": "Content-Type, Authorization",
			"access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
			"access-control-allow-origin": "http://localhost:3001",
			"access-control-expose-headers": "Content-Length, X-Request-Id",
			"content-type": "application/json;charset=utf-8",
			vary: "Origin",
		});
	});

	it("/me vero: 422 prima del 401 per un anonimo con input non valido", async () => {
		const res = await req("/me/avatar", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ file: "x" }),
		});
		expect(res.status).toBe(422);
		expect(await res.json()).toEqual(
			errorBody("VALIDATION_ERROR", "File: tipo di file non ammesso"),
		);
	});
});

describe("path grezzo come Elysia (`moduleApp`)", () => {
	const elysia = new Elysia()
		.use(errorHandler)
		.state("pino", noopPino)
		.get("/p/:id", ({ params }) => ({ id: params.id }))
		.delete("/avatar", () => ({ ok: true }));
	const hono = moduleApp()
		.get("/p/:id", (c) => c.json({ id: c.req.param("id") }))
		.delete("/avatar", (c) => c.json({ ok: true }));
	for (const [method, path] of [
		["DELETE", "/%61vatar"],
		["DELETE", "/av%61tar"],
		["DELETE", "/avatar/"],
		["GET", "/p/caf%C3%A9"],
		["GET", "/p/a%2Fb"],
		["GET", "/p/a%20b?x=1"],
		["GET", "/%70/x"],
		["DELETE", "/avatar#x"],
		["GET", "/p/a#b"],
	])
		it(`${method} ${path}`, async () => {
			const init = { method };
			const e = await elysia.handle(
				new Request(`http://localhost${path}`, init),
			);
			const h = await hono.request(`http://localhost${path}`, init);
			expect({ status: h.status, body: await h.json() }).toEqual({
				status: e.status,
				body: await e.json(),
			});
		});

	it("radice di una sub-app montata: /x e /x/ sì, /x// no, come Elysia", async () => {
		const root = new Elysia()
			.use(errorHandler)
			.state("pino", noopPino)
			.get("/elysia", () => ({ ok: true }))
			.mount("/hono", moduleApp().get("/", (c) => c.json({ ok: true })).fetch);
		for (const suffix of ["", "/", "//"]) {
			const e = await root.handle(
				new Request(`http://localhost/elysia${suffix}`),
			);
			const h = await root.handle(
				new Request(`http://localhost/hono${suffix}`),
			);
			expect([suffix, h.status]).toEqual([suffix, e.status]);
		}
	});

	it("/me/%61vatar montato: 404 come prima", async () => {
		const res = await req("/me/%61vatar", { method: "DELETE" });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual(
			errorBody("NOT_FOUND", "Risorsa non trovata"),
		);
	});
});

// U5: /seller è in parte Hono (prodotti, brand, immagini, caratteristiche,
// stock; da U6 negozi, impostazioni, team, onboarding, profilo, dashboard) e
// in parte ancora Elysia (U7), come in `src/index.ts`. U6 ha spostato le route
// dei negozi dalla prima lista alla seconda e messo nella prima quelle di U7
// sotto /stores (checkout), che Elysia deve continuare a prendere.
describe("mount — modulo migrato in parte (/seller)", () => {
	const hits: string[] = [];
	const partial = new Elysia()
		.state("pino", noopPino)
		.use(errorHandler)
		.use(sellerModule)
		.mount("/seller", (request) => {
			hits.push(`${request.method} ${new URL(request.url).pathname}`);
			return sellerApp.fetch(request);
		});
	const send = (method: string, path: string) =>
		partial.handle(new Request(`http://localhost${path}`, { method }));
	const unauthorized = errorBody(
		"UNAUTHORIZED",
		"Devi accedere per continuare",
	);

	for (const [method, path] of [
		["GET", "/seller/stores/checkout/p1"],
		["POST", "/seller/stores/s1/reactivation-checkout"],
		["GET", "/seller/billing/subscriptions"],
		["GET", "/seller/discounts/d1/products"],
	])
		it(`${method} ${path}: risponde Elysia, Hono non la vede`, async () => {
			hits.length = 0;
			const res = await send(method, path);
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual(unauthorized);
			expect(hits).toEqual([]);
		});

	for (const [method, path, status] of [
		["GET", "/seller/products", 401],
		["GET", "/seller/products/p1", 401],
		["DELETE", "/seller/products/p1/images/i1", 401],
		["PATCH", "/seller/products/p1/stores/s1", 422],
		["GET", "/seller/product-categories/c1/characteristics", 401],
		["GET", "/seller/stores", 401],
		["DELETE", "/seller/stores/s1", 401],
		["DELETE", "/seller/stores/s1/images/i1", 401],
		["GET", "/seller/settings", 401],
		["GET", "/seller/profile", 401],
		["GET", "/seller/nope", 404],
	] as const)
		it(`${method} ${path}: arriva a Hono senza prefisso`, async () => {
			hits.length = 0;
			const res = await send(method, path);
			expect(res.status).toBe(status);
			expect(hits).toEqual([`${method} ${path.replace("/seller", "")}`]);
		});
});

describe("better-auth su Hono (strada di U11)", () => {
	it("hono/mount toglie /auth: better-auth resta su basePath /api", async () => {
		const root = new Hono().all("/auth/*", mount(auth.handler));
		const res = await root.request("http://localhost/auth/api/ok");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});
