import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { resolveSellerAccess } from "@/modules/seller/context";
import { guard } from "./routes";

type Session = typeof auth.$Infer.Session;

/** Variabili di ogni route con login (oggi il resolve della macro `auth`). */
export type AuthEnv = {
	Variables: { user: Session["user"]; session: Session["session"] };
};

/** Il `Context` di ogni guardia, qualunque sia il suo Env (seller, admin, …). */
interface SessionContext {
	req: Pick<Context["req"], "raw">;
	get(key: "user"): Session["user"] | undefined;
	set(key: "user", value: Session["user"]): void;
	set(key: "session", value: Session["session"]): void;
}

/**
 * La sessione better-auth in `c.var` (la macro `auth: true` di
 * `plugins/better-auth.ts`): stessa sessione, stesso 401. La leggono tutte le
 * guardie, anche quelle di ruolo, così l'ordine fra guardie non conta. Se un
 * middleware a monte ha già messo l'utente (i test,
 * `tests/helpers/hono-app.ts`) non la rilegge: solo il codice può scrivere
 * `c.var`.
 */
async function readSession(c: SessionContext) {
	if (c.get("user")) return;
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) throw new ServiceError(401, "Devi accedere per continuare");
	c.set("user", session.user);
	c.set("session", session.session);
}

/**
 * Login obbligatorio. Va in ogni route **dopo** i suoi `v(...)`, mai come
 * `app.use` del modulo: oggi la validazione precede l'auth (422 prima di 401,
 * D9 del piano Hono); `assertRoutes` lo controlla.
 */
export const requireAuth = guard(
	createMiddleware<AuthEnv>(async (c, next) => {
		await readSession(c);
		await next();
	}),
	"auth",
);

/** Chi chiama e per quale venditore agisce (`resolveSellerAccess`). */
export type SellerAccess = Awaited<ReturnType<typeof resolveSellerAccess>>;

/** Variabili delle route seller con partita IVA verificata. */
export type SellerEnv = {
	Variables: AuthEnv["Variables"] & { seller: SellerAccess };
};

/**
 * La guardia del modulo seller per le route operative (oggi il `.guard` con
 * `resolveSellerAccess` di `modules/seller/index.ts`): login (401), poi
 * titolare con onboarding attivo o dipendente con incarico attivo di un
 * venditore attivo (i quattro 403), in `c.var.seller`. Dopo i `v(...)` come
 * `requireAuth`; non rilegge `c.var.seller` se c'è già (test, D13).
 */
export const requireSeller = guard(
	createMiddleware<SellerEnv>(async (c, next) => {
		await readSession(c);
		if (!c.get("seller"))
			c.set("seller", await resolveSellerAccess(c.get("user")));
		await next();
	}),
	"seller",
);
