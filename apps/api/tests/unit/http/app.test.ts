import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { unlink } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { app, rootApp } from "@/app";
import { moduleApp } from "@/http/app";
import { errorBody } from "@/http/responses";
import { ServiceError } from "@/lib/errors";
import { meApp } from "@/modules/me";

// L'app radice (U11 del piano Hono, `src/app.ts`): cosa dà a ogni sub-app
// (CORS, `x-request-id`, riga di log, `x-forwarded-for` dal socket, body
// intatti, errori e 404) e, contro `golden/app-*.json`, le risposte e le righe
// di log dell'API di prima (catturate prima di U11) su /health, /ready,
// /openapi, better-auth e i moduli, in sviluppo e in produzione. Fino a U11
// questo file provava il mount delle sub-app nell'app di prima (D8).

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

const root = rootApp()
	.route("/zz-plain", probe())
	.route("/zz-kit", moduleApp().route("/", probe()))
	.route("/me", meApp);

const req = (path: string, init?: RequestInit) =>
	Promise.resolve(root.request(`http://localhost${path}`, init));

const ORIGIN = { origin: "http://localhost:3001" };

// La riga di log come { path, status }: `<ora> <livello> <durata> <metodo> <path> <status> `.
function loggedRequests(lines: unknown[][]) {
	return lines.flatMap(([line]) => {
		const m = /^\S+ \S+ \S+ \S+\s+(\S+) (\d{3}) $/.exec(String(line));
		return m ? [{ path: m[1], status: Number(m[2]) }] : [];
	});
}

afterEach(() => {
	for (const name of ["info", "warn", "error"] as const)
		(console[name] as { mockRestore?: () => void }).mockRestore?.();
});

describe("app radice — cosa dà alle sub-app", () => {
	it("preflight CORS risposto dalla radice", async () => {
		const res = await req("/me/avatar", {
			method: "OPTIONS",
			headers: { ...ORIGIN, "access-control-request-method": "POST" },
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN.origin);
		expect(res.headers.get("access-control-max-age")).toBe("86400");
	});

	it("header CORS e x-request-id sulle risposte delle sub-app", async () => {
		const res = await req("/zz-plain/echo", { headers: ORIGIN });
		expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN.origin);
		expect(res.headers.get("access-control-allow-credentials")).toBe("true");
		expect(res.headers.get("access-control-expose-headers")).toBe(
			"Content-Length,X-Request-Id",
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

	it("la riga di log registra la richiesta con lo status di Hono", async () => {
		const info = spyOn(console, "info").mockImplementation(() => {});
		await req("/zz-plain/cookie");
		const logs = loggedRequests(info.mock.calls);
		expect(logs).toContainEqual({ path: "/zz-plain/cookie", status: 201 });
	});

	it("x-forwarded-for sovrascritto con l'IP del socket anche per Hono", async () => {
		const server = Bun.serve({ port: 0, fetch: root.fetch });
		try {
			const res = await fetch(`http://localhost:${server.port}/zz-plain/echo`, {
				headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" },
			});
			const { headers } = await res.json();
			expect(headers["x-forwarded-for"]).not.toBe("6.6.6.6");
			expect(headers["x-forwarded-for"]).toBeTruthy();
			expect(headers["x-real-ip"]).toBeUndefined();
		} finally {
			await server.stop(true);
		}
	});
});

describe("app radice — il body arriva intatto", () => {
	it("JSON non letto dalla radice e non trimmato", async () => {
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

describe("app radice — errori e 404", () => {
	it("con moduleApp(): inviluppo JSON, Content-Type di sempre, x-request-id", async () => {
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

	it("/me vero: 401 con gli header CORS", async () => {
		const res = await req("/me/avatar", { method: "DELETE", headers: ORIGIN });
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual(
			errorBody("UNAUTHORIZED", "Devi accedere per continuare"),
		);
		expect(Object.fromEntries(res.headers)).toMatchObject({
			"access-control-allow-credentials": "true",
			"access-control-allow-origin": "http://localhost:3001",
			"access-control-expose-headers": "Content-Length,X-Request-Id",
			"content-type": "application/json;charset=utf-8",
			vary: "Origin",
		});
		expect(res.headers.has("access-control-allow-methods")).toBe(false);
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

// Path grezzo e slash finale come prima (`moduleApp`, D8): gli esiti di prima
// sono in `golden/raw-path.json`.
const rawPaths: {
	paths: Record<string, { status: number; body: unknown }>;
	rootSuffixes: Record<string, number>;
} = await Bun.file(join(import.meta.dir, "golden/raw-path.json")).json();

describe("path grezzo come prima (`moduleApp`)", () => {
	const hono = moduleApp()
		.get("/p/:id", (c) => c.json({ id: c.req.param("id") }))
		.delete("/avatar", (c) => c.json({ ok: true }));
	for (const [key, expected] of Object.entries(rawPaths.paths)) {
		const [method, path] = key.split(" ");
		it(key, async () => {
			const h = await hono.request(`http://localhost${path}`, { method });
			expect({ status: h.status, body: await h.json() }).toEqual(expected);
		});
	}

	it("radice di una sub-app: /x e /x/ sì, /x// no, come prima", async () => {
		const withSub = rootApp().route(
			"/hono",
			moduleApp().get("/", (c) => c.json({ ok: true })),
		);
		for (const suffix of ["", "/", "//"]) {
			const h = await withSub.request(`http://localhost/hono${suffix}`);
			expect([suffix, h.status]).toEqual([
				suffix,
				rawPaths.rootSuffixes[suffix],
			]);
		}
	});

	it("/me/%61vatar: 404 come prima", async () => {
		const res = await req("/me/%61vatar", { method: "DELETE" });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual(
			errorBody("NOT_FOUND", "Risorsa non trovata"),
		);
	});
});

// /seller attraverso l'app radice vera: ogni route arriva alla sub-app.
describe("app radice — modulo /seller", () => {
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
		["GET", "/seller/employees/e1/stores", 401],
		["GET", "/seller/stores/checkout/p1", 401],
		["POST", "/seller/stores/s1/reactivation-checkout", 401],
		["GET", "/seller/billing/subscriptions", 401],
		["GET", "/seller/discounts/d1/products", 401],
		["GET", "/seller/nope", 404],
	] as const)
		it(`${method} ${path}: ${status}`, async () => {
			const res = await app.request(`http://localhost${path}`, { method });
			expect(res.status).toBe(status);
		});
});

describe("better-auth sulla radice", () => {
	it("hono/mount toglie /auth: better-auth resta su basePath /api", async () => {
		const res = await app.request("http://localhost/auth/api/ok");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});

/**
 * Una richiesta scritta a mano su un socket vero: con un Host non valido Bun
 * dà a `request.url` solo il path (o un URL che non si analizza), cosa che
 * `fetch` e `app.request` non sanno produrre.
 */
async function rawHttp(port: number, lines: string[], body = "") {
	const text = await new Promise<string>((resolve, reject) => {
		let out = "";
		const socket = connect(port, "127.0.0.1", () =>
			socket.write(`${lines.join("\r\n")}\r\n\r\n${body}`),
		);
		socket.on("data", (d) => {
			out += d;
		});
		socket.on("close", () => resolve(out));
		socket.on("error", reject);
	});
	const split = text.indexOf("\r\n\r\n");
	const [statusLine, ...headerLines] = text.slice(0, split).split("\r\n");
	const headers = Object.fromEntries(
		headerLines.map((l) => {
			const i = l.indexOf(":");
			return [l.slice(0, i).toLowerCase(), l.slice(i + 1).trim()];
		}),
	);
	return {
		status: Number(statusLine?.split(" ")[1]),
		headers,
		body: text.slice(split + 4),
	};
}

// Delta 19 del piano Hono: rispondono come prima il preflight, /health, /ready
// e /openapi; il resto è un 400 senza arrivare a una route (prima: 500), e la
// riga di log c'è sempre. Prima della correzione il path perdeva il primo
// segmento (`/xxx/register/customer` arrivava a `/register/customer`), la
// route girava e la riga di log lanciava («Invalid URL» → 500 dopo l'handler).
describe("app radice — Host non valido (socket vero)", () => {
	const send = async (lines: string[], body = "") => {
		const server = Bun.serve({ port: 0, fetch: app.fetch });
		try {
			return await rawHttp(server.port as number, lines, body);
		} finally {
			await server.stop(true);
		}
	};
	const close = "Connection: close";

	it("GET /health con Host vuoto: 200 e la riga di log", async () => {
		const info = spyOn(console, "info").mockImplementation(() => {});
		const res = await send(["GET /health HTTP/1.1", "Host: ", close]);
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ status: "ok" });
		expect(loggedRequests(info.mock.calls)).toContainEqual({
			path: "/health",
			status: 200,
		});
	});

	it("GET /health in HTTP/1.0 senza Host e con una porta fuori range: 200", async () => {
		for (const lines of [
			["GET /health HTTP/1.0"],
			["GET /health HTTP/1.1", "Host: localhost:99999", close],
		]) {
			const res = await send(lines);
			expect([lines[0], res.status]).toEqual([lines[0], 200]);
		}
	});

	it("preflight con Host vuoto: 204 con CORS", async () => {
		const res = await send([
			"OPTIONS /health HTTP/1.1",
			"Host: ",
			"Origin: http://localhost:3001",
			"Access-Control-Request-Method: GET",
			close,
		]);
		expect(res.status).toBe(204);
		expect(res.headers["access-control-allow-origin"]).toBe(
			"http://localhost:3001",
		);
	});

	it("una route di modulo non gira: 400, non 422, e nessun path spostato", async () => {
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		for (const path of ["/register/customer", "/xxx/register/customer"]) {
			const res = await send(
				[
					`POST ${path} HTTP/1.1`,
					"Host: ",
					"Content-Type: application/json",
					"Content-Length: 2",
					close,
				],
				"{}",
			);
			expect([path, res.status]).toEqual([path, 400]);
			expect(JSON.parse(res.body)).toEqual(
				errorBody("BAD_REQUEST", "Richiesta non valida"),
			);
			expect(res.headers["x-request-id"]).toBeTruthy();
			expect(loggedRequests(warn.mock.calls)).toContainEqual({
				path,
				status: 400,
			});
		}
	});

	it("better-auth e i moduli con Host fuori range: 400", async () => {
		for (const path of ["/auth/api/ok", "/me/avatar"]) {
			const res = await send([
				`GET ${path} HTTP/1.1`,
				"Host: localhost:99999",
				close,
			]);
			expect([path, res.status]).toEqual([path, 400]);
		}
	});
});

// ── contro le risposte di prima (`golden/app-*.json`) ───────────────────────

const LOCAL = "http://localhost:3001";
const EVIL = "https://evil.example";
const PROD = "https://app.bibs.example";

/** Le richieste della cattura (`notes/golden/capture-app.ts` del piano). */
interface Spec {
	name: string;
	method?: string;
	path: string;
	headers?: Record<string, string>;
	body?: string;
	skipBody?: boolean;
}
const SPECS: Spec[] = [
	{
		name: "preflight, origine localhost",
		method: "OPTIONS",
		path: "/me/avatar",
		headers: {
			origin: LOCAL,
			"access-control-request-method": "POST",
			"access-control-request-headers": "content-type",
		},
	},
	{
		name: "preflight, origine di produzione",
		method: "OPTIONS",
		path: "/me/avatar",
		headers: { origin: PROD, "access-control-request-method": "POST" },
	},
	{
		name: "preflight, origine non ammessa",
		method: "OPTIONS",
		path: "/me/avatar",
		headers: { origin: EVIL, "access-control-request-method": "POST" },
	},
	{
		name: "OPTIONS senza origine né metodo, path inesistente",
		method: "OPTIONS",
		path: "/nope",
	},
	{
		name: "preflight su better-auth",
		method: "OPTIONS",
		path: "/auth/api/sign-in/email",
		headers: { origin: LOCAL, "access-control-request-method": "POST" },
	},
	{
		name: "health, origine localhost",
		path: "/health",
		headers: { origin: LOCAL },
	},
	{
		name: "health, origine di produzione",
		path: "/health",
		headers: { origin: PROD },
	},
	{
		name: "health, origine non ammessa",
		path: "/health",
		headers: { origin: EVIL },
	},
	{
		name: "health, x-request-id valido",
		path: "/health",
		headers: { "x-request-id": "edge-1" },
	},
	{
		name: "health, x-request-id non valido",
		path: "/health",
		headers: { "x-request-id": "has space" },
	},
	{ name: "health con lo slash finale", path: "/health/" },
	{ name: "HEAD health", method: "HEAD", path: "/health" },
	{ name: "POST health", method: "POST", path: "/health" },
	{ name: "ready", path: "/ready" },
	{ name: "404 alla radice", path: "/nope", headers: { origin: LOCAL } },
	{ name: "radice", path: "/" },
	{ name: "pagina openapi", path: "/openapi", headers: { origin: LOCAL } },
	{ name: "openapi json", path: "/openapi/json", skipBody: true },
	{
		name: "better-auth ok",
		path: "/auth/api/ok",
		headers: { origin: LOCAL },
	},
	{ name: "better-auth get-session anonima", path: "/auth/api/get-session" },
	{ name: "better-auth path inesistente", path: "/auth/api/nope" },
	{ name: "/auth nudo", path: "/auth" },
	{
		name: "modulo: 401",
		method: "DELETE",
		path: "/me/avatar",
		headers: { origin: LOCAL },
	},
	{
		name: "modulo: 404 sotto il prefisso",
		path: "/me/nope",
		headers: { origin: LOCAL },
	},
	{ name: "modulo: path codificato", method: "DELETE", path: "/me/%61vatar" },
	{
		name: "modulo: JSON malformato",
		method: "POST",
		path: "/me/avatar",
		headers: { "content-type": "application/json" },
		body: "{",
	},
	{
		name: "modulo: 422 prima del 401",
		method: "POST",
		path: "/me/avatar",
		headers: { "content-type": "application/json", origin: LOCAL },
		body: JSON.stringify({ file: "x" }),
	},
	{ name: "admin: 401", path: "/admin/configurations/counts" },
	{ name: "webhooks: GET 404", path: "/webhooks/stripe" },
	{ name: "catalogo: 422", path: "/product-categories?limit=0" },
	{ name: "catalogo: radice con slash", path: "/product-categories/?limit=0" },
	{ name: "catalogo: doppio slash", path: "/product-categories//?limit=0" },
];

/** La risposta di prima: status, header di risposta, corpo, righe di log. */
interface Golden {
	name: string;
	method?: string;
	path: string;
	status: number;
	headers: Record<string, string>;
	body: unknown;
	log: { stream: string; text: string }[];
}

// Senza DB e S3 nei test: /ready si prova sul build vero (Verifica di ogni PR).
async function goldenOf(mode: string) {
	const golden: Golden[] = await Bun.file(
		join(import.meta.dir, `golden/app-${mode}.json`),
	).json();
	expect(golden.map((g) => g.name)).toEqual(SPECS.map((s) => s.name));
	return golden
		.map((g, i) => ({ golden: g, spec: SPECS[i] }))
		.filter(({ spec }) => spec.path !== "/ready");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Status, header (senza `date`, l'id generato come "<generated>") e corpo. */
function snapshot(
	status: number,
	headers: Iterable<[string, string]>,
	body: string,
	spec: Spec,
) {
	const sorted = [...headers]
		.filter(([k]) => k !== "date")
		.map(([k, v]) =>
			k === "x-request-id" && UUID.test(v) ? [k, "<generated>"] : [k, v],
		)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return {
		status,
		headers: Object.fromEntries(sorted),
		body: spec.skipBody ? undefined : body,
	};
}

/** Le differenze del registro dei delta, applicate all'atteso di prima. */
function expected(g: Golden, spec: Spec) {
	const headers = { ...g.headers };
	// Delta 4 (U11): `x-request-id` su ogni risposta, anche sui 404 della radice
	// (`/nope`, `/`, `POST /health`); non sul preflight, che risponde prima.
	if (spec.method !== "OPTIONS" && !headers["x-request-id"])
		headers["x-request-id"] = "<generated>";
	// Delta 5: Hono risponde all'HEAD senza corpo da misurare.
	if (spec.method === "HEAD") delete headers["content-length"];
	// Delta 22: CORS di `hono/cors`. Liste unite con "," invece di ", ";
	// metodi e header ammessi solo sul preflight, che i metodi li dà sempre e
	// aggiunge `Access-Control-Request-Headers` a `vary`.
	for (const key of Object.keys(headers))
		if (key.startsWith("access-control-"))
			headers[key] = headers[key].replaceAll(", ", ",");
	if (spec.method === "OPTIONS") {
		headers["access-control-allow-methods"] =
			"GET,POST,PUT,PATCH,DELETE,OPTIONS";
		headers.vary = "Origin, Access-Control-Request-Headers";
	} else {
		delete headers["access-control-allow-headers"];
		delete headers["access-control-allow-methods"];
	}
	// Delta 16 (U11): la pagina di /openapi dichiara a Scalar l'integrazione
	// "hono" al posto di quella di prima; il resto dell'HTML è identico.
	const body = spec.skipBody
		? undefined
		: String(g.body).replace(
				/"_integration":"[a-z]+js"/,
				'"_integration":"hono"',
			);
	return { status: g.status, headers, body };
}

const toRequest = (spec: Spec) =>
	new Request(`http://localhost${spec.path}`, {
		method: spec.method ?? "GET",
		headers: spec.headers,
		body: spec.body,
	});

const mask = (text: string) =>
	text
		.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<now>")
		.replace(/\b\d+(\.\d+)?(ms|s)\b/g, "<duration>");

const development = await goldenOf("development");

describe("app radice contro le risposte di prima (sviluppo)", () => {
	for (const { golden: g, spec } of development)
		it(`${spec.name}: ${spec.method ?? "GET"} ${spec.path}`, async () => {
			const spies = (["info", "warn", "error"] as const).map((name) => ({
				name,
				spy: spyOn(console, name).mockImplementation(() => {}),
			}));
			const res = await app.request(toRequest(spec));
			expect(snapshot(res.status, res.headers, await res.text(), spec)).toEqual(
				expected(g, spec),
			);
			const log: Golden["log"] = spies.flatMap(({ name, spy }) =>
				spy.mock.calls.map(([text]) => ({
					stream: name,
					text: mask(String(text)),
				})),
			);
			expect(log).toEqual(g.log);
		});
});

describe("app radice contro le risposte di prima (produzione)", () => {
	it("CORS senza localhost, con ALLOWED_ORIGINS", async () => {
		const production = await goldenOf("production");
		// L'env si legge all'import: un processo a parte con NODE_ENV=production,
		// che scrive le risposte in un file.
		const out = join(tmpdir(), `bibs-app-production-${process.pid}.json`);
		const script = `
			const { app } = await import(${JSON.stringify(join(import.meta.dir, "../../../src/app.ts"))});
			const specs = ${JSON.stringify(production.map(({ spec }) => spec))};
			const out = [];
			for (const s of specs) {
				const res = await app.request(new Request("http://localhost" + s.path, {
					method: s.method ?? "GET",
					headers: s.headers,
					body: s.body,
				}));
				out.push({ status: res.status, headers: [...res.headers], body: await res.text() });
			}
			await Bun.write(${JSON.stringify(out)}, JSON.stringify(out));
			process.exit(0);
		`;
		const proc = Bun.spawnSync(["bun", "-e", script], {
			cwd: join(import.meta.dir, "../../.."),
			env: {
				...process.env,
				NODE_ENV: "production",
				ALLOWED_ORIGINS: PROD,
			},
		});
		if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
		const results: {
			status: number;
			headers: [string, string][];
			body: string;
		}[] = await Bun.file(out).json();
		await unlink(out);
		for (const [i, { golden: g, spec }] of production.entries()) {
			const r = results[i];
			expect([spec.name, snapshot(r.status, r.headers, r.body, spec)]).toEqual([
				spec.name,
				expected(g, spec),
			]);
		}
	});
});
