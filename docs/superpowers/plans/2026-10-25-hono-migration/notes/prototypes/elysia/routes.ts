// Read-only: lists routes registered by each Elysia module (no server started).
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET = "test-secret-minimum-32-chars-padding!!";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.S3_ENDPOINT = "http://localhost:9000";
process.env.S3_ACCESS_KEY = "x";
process.env.S3_SECRET_KEY = "x";
process.env.S3_BUCKET = "x";
process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_FAKE";
const R = "/Users/marcogelli/repos/jelaz/bibs/apps/api/src";
const mods: Record<string, string> = {
	admin: `${R}/modules/admin/index.ts:adminModule`,
	catalog: `${R}/modules/catalog/index.ts:catalogModule`,
	customer: `${R}/modules/customer/index.ts:customerModule`,
	locations: `${R}/modules/locations/index.ts:locationsModule`,
	me: `${R}/modules/me/index.ts:meModule`,
	registration: `${R}/modules/registration/index.ts:registration`,
	seller: `${R}/modules/seller/index.ts:sellerModule`,
	webhooks: `${R}/modules/webhooks/index.ts:stripeWebhookRoutes`,
	health: `${R}/plugins/health.ts:health`,
	betterAuth: `${R}/plugins/better-auth.ts:betterAuth`,
};
const out: any[] = [];
for (const [name, spec] of Object.entries(mods)) {
	const [file, exp] = spec.split(":");
	const m = await import(file);
	const app = m[exp];
	for (const r of app.routes) {
		const h = r.hooks ?? {};
		const sv = (h.standaloneValidator ?? []) as any[];
		out.push({
			module: name,
			method: r.method,
			path: r.path,
			auth: !!h.detail?.security || h.auth === true,
			body: !!h.body,
			query: !!h.query,
			params: !!h.params,
			response: h.response
				? Object.keys(
						h.response[Symbol.for("TypeBox.Kind")] ? { 200: 1 } : h.response,
					)
				: [],
			parse: h.parse
				? String(h.parse?.map?.((p: any) => p.fn ?? p) ?? h.parse)
				: undefined,
			beforeHandle: h.beforeHandle
				? Array.isArray(h.beforeHandle)
					? h.beforeHandle.length
					: 1
				: 0,
			tags: h.detail?.tags,
		});
	}
}
console.log(JSON.stringify(out));
