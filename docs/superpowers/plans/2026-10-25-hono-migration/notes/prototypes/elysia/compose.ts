// Read-only: composes the app like src/index.ts (no logixlysia/openapi/listen) and probes a few behaviors.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5999/test";
process.env.BETTER_AUTH_SECRET = "test-secret-minimum-32-chars-padding!!";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.S3_ENDPOINT = "http://localhost:9000";
process.env.S3_ACCESS_KEY = "x";
process.env.S3_SECRET_KEY = "x";
process.env.S3_BUCKET = "x";
process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_FAKE";
const R = "/Users/marcogelli/repos/jelaz/bibs/apps/api/src";
const { Elysia } = await import(`${R}/../node_modules/elysia`);
const { cors } = await import(`${R}/../node_modules/@elysiajs/cors`);
const { isOriginAllowed } = await import(`${R}/lib/cors.ts`);
const { errorHandler } = await import(`${R}/plugins/error-handler.ts`);
const { requestId } = await import(`${R}/plugins/request-id.ts`);
const { normalize } = await import(`${R}/plugins/normalize.ts`);
const { betterAuth } = await import(`${R}/plugins/better-auth.ts`);
const { health } = await import(`${R}/plugins/health.ts`);
const { stripeWebhookRoutes } = await import(`${R}/modules/webhooks/index.ts`);
const { registration } = await import(`${R}/modules/registration/index.ts`);
const { adminModule } = await import(`${R}/modules/admin/index.ts`);
const { catalogModule } = await import(`${R}/modules/catalog/index.ts`);
const { locationsModule } = await import(`${R}/modules/locations/index.ts`);
const { sellerModule } = await import(`${R}/modules/seller/index.ts`);
const { customerModule } = await import(`${R}/modules/customer/index.ts`);
const { meModule } = await import(`${R}/modules/me/index.ts`);
const app = new Elysia()
	.use(
		cors({
			origin: (r: Request) =>
				isOriginAllowed(r.headers.get("origin"), {
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
	.use(stripeWebhookRoutes)
	.use(betterAuth)
	.use(registration)
	.use(adminModule)
	.use(catalogModule)
	.use(locationsModule)
	.use(sellerModule)
	.use(customerModule)
	.use(meModule)
	.use(health);
const routes = app.routes.map((r: any) => `${r.method} ${r.path}`);
console.log("TOTAL", routes.length);
console.log(
	"AUTH-ish:",
	routes.filter((r: string) => r.includes("/auth")).join(" | "),
);
const probe = async (label: string, req: Request) => {
	const res = await app.handle(req);
	const h: Record<string, string> = {};
	res.headers.forEach((v: string, k: string) => {
		h[k] = v;
	});
	const t = await res.text();
	console.log(
		`\n## ${label}\n${res.status} ${JSON.stringify(h)}\n${t.slice(0, 400)}`,
	);
};
await probe(
	"unauth + invalid body",
	new Request("http://localhost/customer/addresses", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	}),
);
await probe(
	"unauth + invalid query admin",
	new Request("http://localhost/admin/product-categories?page=abc"),
);
await probe(
	"unauth + invalid query geocode",
	new Request("http://localhost/locations/geocode?q=a"),
);
await probe(
	"405-ish wrong method",
	new Request("http://localhost/health", { method: "DELETE" }),
);
await probe(
	"HEAD health",
	new Request("http://localhost/health", { method: "HEAD" }),
);
await probe("auth api ok", new Request("http://localhost/auth/api/ok"));
await probe(
	"seller auth api ok",
	new Request("http://localhost/seller/auth/api/ok"),
);
await probe(
	"auth get-session",
	new Request("http://localhost/auth/api/get-session"),
);
await probe(
	"PARSE text body",
	new Request("http://localhost/register/customer", {
		method: "POST",
		headers: { "content-type": "text/plain" },
		body: "hello",
	}),
);
await probe(
	"extra field",
	new Request("http://localhost/register/sign-in", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: "x", password: "p", extra: 1 }),
	}),
);
process.exit(0);
await probe("404", new Request("http://localhost/nope"));
await probe(
	"OPTIONS preflight",
	new Request("http://localhost/customer/cart", {
		method: "OPTIONS",
		headers: {
			origin: "http://localhost:3001",
			"access-control-request-method": "POST",
			"access-control-request-headers": "content-type",
		},
	}),
);
await probe(
	"GET with origin (health)",
	new Request("http://localhost/health", {
		headers: { origin: "http://localhost:3001", "x-request-id": "abc-123" },
	}),
);
await probe(
	"disallowed origin",
	new Request("http://localhost/health", {
		headers: { origin: "https://evil.example" },
	}),
);
await probe(
	"bad x-request-id",
	new Request("http://localhost/health", {
		headers: { "x-request-id": "bad id with spaces" },
	}),
);
await probe(
	"422 register missing password",
	new Request("http://localhost/register/customer", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: "a@b.it" }),
	}),
);
await probe(
	"422 register short pw",
	new Request("http://localhost/register/customer", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: "a@b.it", password: "  short  " }),
	}),
);
await probe(
	"422 bad email",
	new Request("http://localhost/register/sign-in", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: "nope", password: "x" }),
	}),
);
await probe("401 no session", new Request("http://localhost/customer/cart"));
await probe(
	"401 no session admin trailing slash",
	new Request("http://localhost/admin/requests"),
);
await probe(
	"query coercion 422",
	new Request("http://localhost/product-categories?page=abc"),
);
await probe("trailing slash health", new Request("http://localhost/health/"));
await probe(
	"locations/auth mount",
	new Request("http://localhost/locations/auth/ok"),
);
await probe("auth ok", new Request("http://localhost/auth/ok"));
await probe(
	"malformed json",
	new Request("http://localhost/register/customer", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{bad",
	}),
);
process.exit(0);
