// Read-only probe: does better-auth plugin's onRequest XFF overwrite apply to all routes?
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
const { betterAuth } = await import(`${R}/plugins/better-auth.ts`);
const echo = ({ request }: any) => ({
	xff: request.headers.get("x-forwarded-for"),
	xri: request.headers.get("x-real-ip"),
});
const app = new Elysia()
	.get("/before", echo)
	.use(betterAuth)
	.get("/after", echo)
	.use(new Elysia({ prefix: "/m" }).get("/x", echo))
	.listen(0);
const base = `http://127.0.0.1:${app.server!.port}`;
for (const p of ["/before", "/after", "/m/x"]) {
	const r = await fetch(base + p, {
		headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" },
	});
	console.log(p, r.status, await r.text());
}
app.stop();
process.exit(0);
