import { cors as honoCors } from "hono/cors";
import { isOriginAllowed } from "@/lib/cors";
import { env } from "@/lib/env";

/**
 * CORS dei FE, con le credenziali: origine ammessa da `isOriginAllowed`
 * (localhost solo in sviluppo e test, `ALLOWED_ORIGINS` in produzione). Ogni
 * OPTIONS è un preflight: 204 subito, senza arrivare alle route.
 */
export const cors = honoCors({
	origin: (origin) =>
		isOriginAllowed(origin, {
			nodeEnv: env.NODE_ENV,
			allowedOrigins: env.ALLOWED_ORIGINS,
		})
			? origin
			: null,
	allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
	allowHeaders: ["Content-Type", "Authorization"],
	exposeHeaders: ["Content-Length", "X-Request-Id"],
	credentials: true,
	maxAge: 86400,
});
