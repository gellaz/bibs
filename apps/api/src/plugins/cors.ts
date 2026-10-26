import { createMiddleware } from "hono/factory";
import { isOriginAllowed } from "@/lib/cors";
import { env } from "@/lib/env";

// CORS dell'API, con gli stessi header di prima della migrazione (attesi in
// `tests/http/golden/app-*.json`; regole del plugin di prima, MIT:
// `THIRD_PARTY_NOTICES.md`). Non `hono/cors`: unisce gli header con ","
// invece di ", ", dà `access-control-allow-methods` solo al preflight e
// aggiunge `Vary: Access-Control-Request-Headers`.

const METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

/**
 * Ogni risposta porta credenziali, header ammessi ed esposti e
 * `vary: Origin`, più `access-control-allow-origin` se l'origine è ammessa
 * (`isOriginAllowed`: localhost solo in sviluppo e test). Ogni OPTIONS è un
 * preflight: 204 subito, senza arrivare alle route.
 */
export const cors = createMiddleware(async (c, next) => {
	const origin = c.req.header("origin") ?? null;
	const headers = c.res.headers;
	headers.set("access-control-allow-credentials", "true");
	headers.set("access-control-allow-headers", "Content-Type, Authorization");
	headers.set("access-control-expose-headers", "Content-Length, X-Request-Id");
	headers.set("vary", "Origin");
	if (
		isOriginAllowed(origin, {
			nodeEnv: env.NODE_ENV,
			allowedOrigins: env.ALLOWED_ORIGINS,
		})
	)
		headers.set("access-control-allow-origin", origin || "*");
	if (c.req.method === "OPTIONS") {
		if (c.req.header("access-control-request-method"))
			headers.set("access-control-allow-methods", METHODS);
		headers.set("access-control-max-age", "86400");
		return new Response(null, { status: 204, headers });
	}
	headers.set("access-control-allow-methods", METHODS);
	return next();
});
