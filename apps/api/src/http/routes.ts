import type { Hono, MiddlewareHandler } from "hono";
import { type Target, VALIDATES, type Validates } from "./validator";

// Controllo delle route di una sub-app (D9 del piano Hono), fatto a ogni avvio
// da `honoPaths()` e nei test: l'auth sta in ogni route e non nel modulo, quindi
// una route senza guardia sarebbe pubblica in silenzio. Ogni route deve avere
// un middleware di auth (`guard()`) o `publicRoute`, e i `v()` vengono prima
// dell'auth e nell'ordine di Elysia: params, query, body.

const GUARD = Symbol("guard");
const PUBLIC = Symbol("public");

/** Marca un middleware di auth (`requireAuth` e quelli di ruolo). */
export const guard = <M extends MiddlewareHandler<any, any, any>>(m: M) =>
	Object.assign(m, { [GUARD]: true as const });

/** Route volutamente pubblica: middleware che non fa niente. */
export const publicRoute: MiddlewareHandler = Object.assign(
	(_c: unknown, next: () => Promise<void>) => next(),
	{ [PUBLIC]: true as const },
);

const ORDER: Record<Target, number> = { param: 0, query: 1, json: 2, form: 2 };

/** Le route che non rispettano le regole, con il motivo. */
export function routeProblems(app: Hono<any, any, any>): string[] {
	const routes = new Map<string, unknown[]>();
	for (const r of app.routes) {
		// `use()` è ALL; onError e notFound in Hono 5 sono @ERROR e @NOT_FOUND.
		if (r.method === "ALL" || r.method.startsWith("@")) continue;
		const key = `${r.method} ${r.path}`;
		routes.set(key, [...(routes.get(key) ?? []), r.handler]);
	}
	const problems: string[] = [];
	for (const [key, handlers] of routes) {
		const at = (mark: symbol) =>
			handlers.findIndex((h) => !!(h as Record<symbol, unknown>)[mark]);
		const validators = handlers.flatMap((h, i) => {
			const v = (h as { [VALIDATES]?: Validates })[VALIDATES];
			return v ? [{ i, rank: ORDER[v.target] }] : [];
		});
		const auth = at(GUARD);
		if (auth === -1 && at(PUBLIC) === -1)
			problems.push(`${key}: né guardia di auth né publicRoute`);
		if (auth !== -1 && validators.some((v) => v.i > auth))
			problems.push(`${key}: un v() dopo l'auth (422 prima di 401)`);
		if (validators.some((v, n) => n > 0 && v.rank < validators[n - 1].rank))
			problems.push(`${key}: v() fuori ordine (params, query, body)`);
	}
	return problems;
}

/** Lancia se una route non rispetta le regole: l'API non parte. */
export function assertRoutes(app: Hono<any, any, any>) {
	const problems = routeProblems(app);
	if (problems.length)
		throw new Error(`Route Hono non valide:\n${problems.join("\n")}`);
}
