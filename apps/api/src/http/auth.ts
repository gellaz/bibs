import { eq, type InferSelectModel } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { db } from "@/db";
import { customerProfile } from "@/db/schemas/customer";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { guard } from "./routes";

type Session = typeof auth.$Infer.Session;

/** Variabili di ogni route con login (oggi il resolve della macro `auth`). */
export type AuthEnv = {
	Variables: { user: Session["user"]; session: Session["session"] };
};

/**
 * L'utente della sessione, come la macro `auth: true` di
 * `plugins/better-auth.ts`: stesso cookie better-auth, stesso 401. Se un
 * middleware a monte l'ha già messo (i test, `tests/helpers/hono-app.ts`) non
 * rilegge la sessione: solo il codice può scrivere `c.var`.
 */
async function sessionUser<E extends AuthEnv>(c: Context<E>) {
	const current = c.get("user");
	if (current) return current;
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) throw new ServiceError(401, "Devi accedere per continuare");
	c.set("user", session.user);
	c.set("session", session.session);
	return session.user;
}

/**
 * La macro `auth: true` come middleware. Va in ogni route **dopo** i suoi
 * `v(...)`, mai come `app.use` del modulo: oggi la validazione precede l'auth
 * (422 prima di 401, D9 del piano Hono); `assertRoutes` lo controlla.
 */
export const requireAuth = guard(
	createMiddleware<AuthEnv>(async (c, next) => {
		await sessionUser(c);
		await next();
	}),
	"auth",
);

/** Variabili delle route del cliente (oggi il resolve del guard di /customer). */
export type CustomerEnv = {
	Variables: AuthEnv["Variables"] & {
		customerProfile: InferSelectModel<typeof customerProfile>;
	};
};

/**
 * Il guard di `/customer` (auth + resolve del profilo cliente): 401 senza
 * sessione, 403 «Profilo cliente non trovato» per un utente senza profilo
 * cliente. Legge da sé la sessione, quindi basta da solo: nessun ordine fra
 * guardie da rispettare. Come `requireAuth`, dopo i `v(...)` della route e
 * senza rileggere il profilo se un middleware a monte l'ha già messo (i test).
 */
export const requireCustomer = guard(
	createMiddleware<CustomerEnv>(async (c, next) => {
		if (!c.get("customerProfile")) {
			const user = await sessionUser(c);
			const profile = await db.query.customerProfile.findFirst({
				where: eq(customerProfile.userId, user.id),
			});
			if (!profile) throw new ServiceError(403, "Profilo cliente non trovato");
			c.set("customerProfile", profile);
		}
		await next();
	}),
	"customer",
);
