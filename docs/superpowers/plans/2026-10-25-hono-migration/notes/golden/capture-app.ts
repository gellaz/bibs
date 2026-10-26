// Eseguito il 2026-10-26 su 531d8d3f (feat/hono-migration, ultimo commit con
// Elysia) da apps/api/tests/http/golden/: i .test.ts con `bun test <file>`,
// capture-app.ts con `bun --env-file=<env> run` (vedi sotto). Scrive i file
// di apps/api/tests/http/golden/. Non gira più dopo U11 (importa elysia).
// Cattura una tantum (U11, prima di togliere Elysia): l'app composta di
// `src/index.ts` (Elysia 1.4.30 + @elysiajs/cors + logixlysia + mount Hono),
// caricata da `tools/load-app.ts` senza listen né cron. Per ogni richiesta:
// status, header (senza `date`; `x-request-id` generato → "<generated>"),
// corpo, righe di log di logixlysia (ora e durata mascherate) e chiamate al
// transport del file di log. Da `apps/api`, con l'infra su:
//   NODE_ENV=development bun --env-file=<env> run tests/http/golden/capture-app.ts
//   NODE_ENV=production ALLOWED_ORIGINS=https://app.bibs.example bun --env-file=<env> run …
import { join } from "node:path";
import { fileTransport } from "@/lib/logger";

const transportCalls: unknown[] = [];
const original = fileTransport.log;
fileTransport.log = (level, message, meta) => {
	const request = meta?.request as { method?: string; url?: string };
	transportCalls.push({
		level,
		message,
		method: request?.method,
		path: request?.url ? new URL(request.url).pathname : undefined,
		status: meta?.status,
		hasBeforeTime: typeof meta?.beforeTime === "bigint",
	});
	return original(level, message, meta);
};

const lines: { stream: string; text: string }[] = [];
for (const name of ["debug", "info", "warn", "error", "log"] as const) {
	const orig = console[name];
	console[name] = (...args: unknown[]) => {
		lines.push({ stream: name, text: args.map(String).join(" ") });
		orig(...args);
	};
}

const { app } = await import(
	"../../../../../docs/superpowers/plans/2026-10-25-hono-migration/tools/load-app"
);

const LOCAL = "http://localhost:3001";
const EVIL = "https://evil.example";
const PROD = "https://app.bibs.example";

type Spec = {
	name: string;
	method?: string;
	path: string;
	headers?: Record<string, string>;
	body?: string;
	/** Il corpo non si registra (grande o dal DB): solo la lunghezza. */
	skipBody?: boolean;
};

const specs: Spec[] = [
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
	{ name: "better-auth ok", path: "/auth/api/ok", headers: { origin: LOCAL } },
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mask = (text: string) =>
	text
		.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<now>")
		.replace(/\b\d+(\.\d+)?(ms|s)\b/g, "<duration>");

const out: unknown[] = [];
for (const spec of specs) {
	lines.length = 0;
	transportCalls.length = 0;
	const res: Response = await app.handle(
		new Request(`http://localhost${spec.path}`, {
			method: spec.method ?? "GET",
			headers: spec.headers,
			body: spec.body,
		}),
	);
	const text = await res.text();
	await new Promise((resolve) => setTimeout(resolve, 50));
	const headers = [...res.headers]
		.filter(([k]) => k !== "date")
		.map(([k, v]) =>
			k === "x-request-id" && UUID.test(v) ? [k, "<generated>"] : [k, v],
		)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	out.push({
		...spec,
		status: res.status,
		headers: Object.fromEntries(headers),
		body: spec.skipBody ? { length: text.length } : text,
		log: lines.map((l) => ({ stream: l.stream, text: mask(l.text) })),
		transport: [...transportCalls],
	});
}

const mode =
	process.env.NODE_ENV === "production" ? "production" : "development";
await Bun.write(
	join(import.meta.dir, `app-${mode}.json`),
	JSON.stringify(out, null, "\t"),
);
console.error(`wrote app-${mode}.json (${out.length} richieste)`);
process.exit(0);
