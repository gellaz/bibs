import { cors as honoCors } from "hono/cors";
import { env } from "@/infra/env";

const LOCALHOST = /^http:\/\/localhost(:\d+)?$/;
// Explicit allow-list of environments where localhost CORS is permitted. Using an
// allow-list (rather than `!== "production"`) fails closed for any unrecognised or
// typo'd NODE_ENV — only known dev/test environments open the localhost branch.
const LOCALHOST_ENVS = new Set(["development", "test"]);

interface OriginPolicy {
	nodeEnv: string;
	allowedOrigins: string | undefined;
}

/**
 * CORS origin policy. In development/test any `http://localhost` origin (any port)
 * is allowed; in production only the explicit `ALLOWED_ORIGINS` allow-list is
 * honoured. Combined with `credentials: true`, gating localhost behind the
 * environment prevents a malicious local service from making credentialed
 * cross-origin requests against a deployed API. NB: production deployments must
 * set NODE_ENV explicitly (the env default is "development").
 */
export function isOriginAllowed(
	origin: string | null,
	{ nodeEnv, allowedOrigins }: OriginPolicy,
): boolean {
	if (LOCALHOST_ENVS.has(nodeEnv) && origin && LOCALHOST.test(origin)) {
		return true;
	}

	const allowList =
		allowedOrigins
			?.split(",")
			.map((o) => o.trim())
			.filter(Boolean) ?? [];

	return allowList.includes(origin ?? "");
}

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
