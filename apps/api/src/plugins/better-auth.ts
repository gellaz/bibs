import { Elysia } from "elysia";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";

export const betterAuth = new Elysia({ name: "better-auth" })
	// Inject x-forwarded-for from Bun's socket before better-auth's rate-limiter
	// runs. Without this, better-auth cannot resolve the client IP on direct
	// (non-proxied) connections and silently skips rate-limiting for all /auth/* paths.
	// CAVEAT prod: un client diretto può spoofare x-forwarded-for (qui iniettiamo
	// solo se ASSENTE). Dietro reverse-proxy l'header è gestito dal proxy; per
	// l'esposizione diretta in produzione serve la trusted-proxy hardening (P3
	// nella gap analysis). Pre-fix il limiter era comunque DISATTIVO del tutto.
	.onRequest(({ request, server }) => {
		if (!request.headers.has("x-forwarded-for")) {
			const ip = server?.requestIP(request)?.address;
			if (ip) {
				const headers = new Headers(request.headers);
				headers.set("x-forwarded-for", ip);
				// Reassign request with injected header so auth.handler sees it.
				// Elysia mutates ctx.request; we return a new Request so downstream
				// lifecycle hooks (including the mount handler) see the updated headers.
				Object.defineProperty(request, "headers", { value: headers });
			}
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
