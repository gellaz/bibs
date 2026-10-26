// PROBE prototype (not shipped): the Hono side of plugins/better-auth.ts and the
// role guards in modules/{admin,seller,customer}/index.ts.
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { mount } from "hono/mount";
import { db } from "@/db";
import { customerProfile } from "@/db/schemas/customer";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { resolveSellerAccess } from "@/modules/seller/context";

type Session = typeof auth.$Infer.Session;

/** Variables every authenticated sub-app sees (today: the `auth` macro resolve). */
export type AuthEnv = {
	Variables: { user: Session["user"]; session: Session["session"] };
};

/** Same lookup and same 401 as the `auth: true` macro in plugins/better-auth.ts. */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) throw new ServiceError(401, "Devi accedere per continuare");
	c.set("user", session.user);
	c.set("session", session.session);
	await next();
});

// role guards: same messages as the .resolve() of each module guard
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
	if (c.var.user.role !== "admin")
		throw new ServiceError(403, "Accesso riservato agli amministratori");
	await next();
});

/** seller profile/onboarding routes: role only, no VAT gate. */
export const requireSellerRole = createMiddleware<AuthEnv>(async (c, next) => {
	if (c.var.user.role !== "seller")
		throw new ServiceError(403, "Accesso riservato ai venditori");
	await next();
});

export type SellerAccess = Awaited<ReturnType<typeof resolveSellerAccess>>;
export type SellerEnv = {
	Variables: AuthEnv["Variables"] & { seller: SellerAccess };
};
/** every other seller route: owner with active onboarding or active employee. */
export const requireSeller = createMiddleware<SellerEnv>(async (c, next) => {
	c.set("seller", await resolveSellerAccess(c.var.user));
	await next();
});

type CustomerProfile = typeof customerProfile.$inferSelect;
export type CustomerEnv = {
	Variables: AuthEnv["Variables"] & { customerProfile: CustomerProfile };
};
export const requireCustomer = createMiddleware<CustomerEnv>(
	async (c, next) => {
		const profile = await db.query.customerProfile.findFirst({
			where: eq(customerProfile.userId, c.var.user.id),
		});
		if (!profile) throw new ServiceError(403, "Profilo cliente non trovato");
		c.set("customerProfile", profile);
		await next();
	},
);

/**
 * Hono twin of the betterAuth plugin's onRequest: overwrite x-forwarded-for with
 * the socket peer (Bun passes its server as the 2nd fetch arg = c.env) and drop
 * x-real-ip, so better-auth's limiter keys on the real IP. Same defineProperty
 * trick as today so c.req.raw (and whatever reads it later) sees the new headers.
 */
export const socketIpAsForwardedFor = createMiddleware<{
	Bindings: { requestIP?: (r: Request) => { address: string } | null };
}>(async (c, next) => {
	// app.request()/tests have no server: same "skip" as server?.requestIP today
	const ip = c.env?.requestIP?.(c.req.raw)?.address;
	if (ip) {
		const headers = new Headers(c.req.raw.headers);
		headers.set("x-forwarded-for", ip);
		headers.delete("x-real-ip");
		Object.defineProperty(c.req.raw, "headers", { value: headers });
	}
	await next();
});

/** `.mount("/auth", auth.handler)` → hono/mount strips "/auth" exactly like Elysia. */
export const betterAuthHandler = mount(auth.handler);
