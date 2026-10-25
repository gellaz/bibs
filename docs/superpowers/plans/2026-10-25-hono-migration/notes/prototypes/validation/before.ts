// "Before": the real Elysia app (same .use chain as src/index.ts, minus
// logixlysia/cron/listen/ensureBucket). Run: bun probe/before.ts > out
import "../tests/preload";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { OpenAPI } from "@/lib/auth";
import { isOriginAllowed } from "@/lib/cors";
import { env } from "@/lib/env";
import { adminModule } from "@/modules/admin";
import { catalogModule } from "@/modules/catalog";
import { customerModule } from "@/modules/customer";
import { locationsModule } from "@/modules/locations";
import { meModule } from "@/modules/me";
import { registration } from "@/modules/registration";
import { sellerModule } from "@/modules/seller";
import { stripeWebhookRoutes } from "@/modules/webhooks";
import { betterAuth } from "@/plugins/better-auth";
import { errorHandler } from "@/plugins/error-handler";
import { health } from "@/plugins/health";
import { normalize } from "@/plugins/normalize";
import { requestId } from "@/plugins/request-id";
import { cases, toRequest } from "./cases";

export const app = new Elysia()
	.use(
		cors({
			origin: (request) =>
				isOriginAllowed(request.headers.get("origin"), {
					nodeEnv: env.NODE_ENV,
					allowedOrigins: env.ALLOWED_ORIGINS,
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
				info: { title: "bibs API", description: "x", version: "1.0.0" },
				components: {
					...(await OpenAPI.components),
					securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
				},
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
	.use(meModule)
	.use(health);

if (import.meta.main && process.argv.includes("--cold-openapi")) {
	const spec = await (
		await app.handle(new Request("http://localhost/openapi/json"))
	).json();
	await Bun.write(
		`${process.env.OUT_DIR}/openapi-cold.json`,
		JSON.stringify(spec, null, 2),
	);
	process.exit(0);
}
if (import.meta.main) {
	const out: Record<string, unknown> = {};
	for (const c of cases) {
		if (c.path.startsWith("/customer/products") && !c.name.startsWith("q-"))
			continue;
		const res = await app.handle(toRequest(c));
		out[c.name] = { status: res.status, body: await res.text() };
	}
	if (process.argv.includes("--openapi")) {
		const spec = await (
			await app.handle(new Request("http://localhost/openapi/json"))
		).json();
		await Bun.write(
			`${process.env.OUT_DIR}/openapi-before.json`,
			JSON.stringify(spec, null, 2),
		);
	}
	await Bun.write(
		`${process.env.OUT_DIR}/before.json`,
		JSON.stringify(out, null, 2),
	);
	process.exit(0);
}
