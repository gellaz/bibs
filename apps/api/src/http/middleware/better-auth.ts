import { createMiddleware } from "hono/factory";
import { mount } from "hono/mount";
import { auth } from "@/infra/auth";

/** Minimal structural type for Bun's server, the `env` of `Bun.serve({ fetch: app.fetch })`. */
interface RequestIpResolver {
	requestIP(request: Request): { address: string } | null;
}

/**
 * Overwrite x-forwarded-for with Bun's socket peer address before
 * better-auth's rate-limiter runs. Without a resolvable client IP,
 * better-auth silently skips rate-limiting for all /auth/* paths on
 * direct (non-proxied) connections. The OVERWRITE (not set-if-absent)
 * + x-real-ip strip guarantee client-supplied values never reach the
 * limiter — a spoofed header would otherwise be a rate-limit bypass.
 * CAVEAT: dietro un reverse-proxy il socket IP è quello del proxy, quindi
 * questo hook andrà sostituito dalla trusted-proxy hardening (P3 nella gap
 * analysis) prima del deploy. Oggi bibs è esposto solo in diretta (dev).
 *
 * Global, first thing after CORS (`src/app.ts`): every route and the
 * better-auth mount see the rewritten headers. Without a server (tests,
 * `app.request`, the Hono CLI) there is no socket and the headers stay as sent.
 */
export const socketIpAsForwardedFor = createMiddleware(async (c, next) => {
	const server: RequestIpResolver | undefined =
		typeof c.env?.requestIP === "function" ? c.env : undefined;
	const ip = server?.requestIP(c.req.raw)?.address;
	if (ip) {
		const headers = new Headers(c.req.raw.headers);
		headers.set("x-forwarded-for", ip);
		headers.delete("x-real-ip");
		// Same Request object, new headers: `c.req.header()` and the Request
		// that `hono/mount` rebuilds for better-auth both read them.
		Object.defineProperty(c.req.raw, "headers", { value: headers });
	}
	await next();
});

/**
 * better-auth on `/auth/*` (also `/auth`): `hono/mount` strips `/auth`, so
 * better-auth keeps `basePath: "/api"` and the public paths stay `/auth/api/…`.
 * The path is cut from the raw URL, trailing slash included (`/auth/api/ok/`
 * stays a better-auth 404, as before): `hono/mount` would cut `c.req.path`,
 * which `rawPath` has already stripped of it.
 */
export const authHandler = mount(auth.handler, {
	replaceRequest: (request) => {
		const url = new URL(request.url);
		url.pathname = url.pathname.slice("/auth".length) || "/";
		return new Request(url, request);
	},
});
