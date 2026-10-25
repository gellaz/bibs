import { createMiddleware } from "hono/factory";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";

type Session = typeof auth.$Infer.Session;

/** Variabili di ogni route con login (oggi il resolve della macro `auth`). */
export type AuthEnv = {
	Variables: { user: Session["user"]; session: Session["session"] };
};

/**
 * La macro `auth: true` di `plugins/better-auth.ts` come middleware: stessa
 * sessione (cookie better-auth), stesso 401. Va in ogni route **dopo** i suoi
 * `v(...)`, mai come `app.use` del modulo: oggi la validazione precede l'auth
 * (422 prima di 401, D9 del piano Hono).
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) throw new ServiceError(401, "Devi accedere per continuare");
	c.set("user", session.user);
	c.set("session", session.session);
	await next();
});
