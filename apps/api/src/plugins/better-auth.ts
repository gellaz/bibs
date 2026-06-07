import { Elysia } from "elysia";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";

export const betterAuth = new Elysia({ name: "better-auth" })
	// Overwrite x-forwarded-for with Bun's socket peer address before
	// better-auth's rate-limiter runs. Without a resolvable client IP,
	// better-auth silently skips rate-limiting for all /auth/* paths on
	// direct (non-proxied) connections. The OVERWRITE (not set-if-absent)
	// + x-real-ip strip guarantee client-supplied values never reach the
	// limiter — a spoofed header would otherwise be a rate-limit bypass.
	// CAVEAT: dietro un reverse-proxy il socket IP è quello del proxy, quindi
	// questo hook andrà sostituito dalla trusted-proxy hardening (P3 nella gap
	// analysis) prima del deploy. Oggi bibs è esposto solo in diretta (dev).
	.onRequest(({ request, server }) => {
		const ip = server?.requestIP(request)?.address;
		if (ip) {
			const headers = new Headers(request.headers);
			headers.set("x-forwarded-for", ip);
			headers.delete("x-real-ip");
			// Reassign request with injected header so auth.handler sees it.
			// Elysia mutates ctx.request; we return a new Request so downstream
			// lifecycle hooks (including the mount handler) see the updated headers.
			Object.defineProperty(request, "headers", { value: headers });
		}
	})
	.mount("/auth", auth.handler)
	.macro({
		auth: {
			async resolve({ request: { headers } }) {
				const session = await auth.api.getSession({
					headers,
				});
				if (!session) throw new ServiceError(401, "Authentication required");
				return {
					user: session.user,
					session: session.session,
				};
			},
		},
	});
