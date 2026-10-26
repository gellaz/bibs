import type { Hono, MiddlewareHandler } from "hono";
import { type Target, VALIDATES, type Validates } from "./validator";

// Controllo delle route di una sub-app (D9 del piano Hono), fatto a ogni avvio
// da `honoPaths()` e nei test: l'auth sta in ogni route e non nel modulo, quindi
// una route senza guardia, o con la guardia sbagliata, sarebbe aperta in
// silenzio. Prima del primo handler vero (tutto ciò che non è `doc()`, `v()`,
// una guardia o `publicRoute`) ogni route deve avere una guardia del modulo
// (es. `requireAdmin` per /admin: `requireAuth` non basta) o `publicRoute`, se
// il modulo dichiara `"publicRoute"`; i `v()` vengono prima dell'auth e
// nell'ordine di Elysia: params, query, body.

/** Le guardie di D9: `requireAuth` e i middleware di ruolo. */
export type GuardTag = "auth" | "customer" | "seller" | "sellerRole" | "admin";

const GUARD = Symbol("guard");
const PUBLIC = Symbol("public");
/** Metadati OpenAPI di `doc()` (`openapi.ts`). */
export const DOC = Symbol("doc");

/** Ciò che un modulo accetta in testa alle route: guardie e `publicRoute`. */
export type ModuleGuard = GuardTag | "publicRoute";

/**
 * Le voci ammesse: una lista per tutto il modulo, o una funzione del path
 * della route per un modulo con guardie diverse (seller: `requireSellerRole`
 * su profilo e onboarding, `requireSeller` sul resto). Una voce basta.
 */
export type ModuleGuards =
	| readonly ModuleGuard[]
	| ((path: string) => readonly ModuleGuard[]);

/**
 * Marca un middleware di auth con la sua guardia. Una guardia già marcata non
 * si rimarca: `guard(requireAuth, "admin")` darebbe a `requireAuth` il ruolo
 * admin senza il controllo del ruolo.
 */
export const guard = <M extends MiddlewareHandler<any, any, any>>(
	m: M,
	tag: GuardTag,
) => {
	const marked = (m as Marked)[GUARD];
	if (marked) throw new Error(`guard(): middleware già marcato "${marked}"`);
	return Object.assign(m, { [GUARD]: tag });
};

/** Route volutamente pubblica: middleware che non fa niente. */
export const publicRoute: MiddlewareHandler = Object.assign(
	(_c: unknown, next: () => Promise<void>) => next(),
	{ [PUBLIC]: true as const },
);

const ORDER: Record<Target, number> = { param: 0, query: 1, json: 2, form: 2 };

type Marked = {
	[GUARD]?: GuardTag;
	[PUBLIC]?: true;
	[DOC]?: unknown;
	[VALIDATES]?: Validates;
};

/**
 * Le route che non rispettano le regole, con il motivo. `guards`: ciò che il
 * modulo accetta (una voce basta); `["publicRoute"]` se tutte le route sono
 * pubbliche, `["customer", "publicRoute"]` per un modulo misto, una funzione
 * del path se cambiano da route a route.
 */
export function routeProblems(
	app: Hono<any, any, any>,
	guards: ModuleGuards,
): string[] {
	const routes = new Map<string, Marked[]>();
	const paths = new Map<string, string>();
	for (const r of app.routes) {
		// `use()` e i mount sono ALL su un path con `*`; onError e notFound in
		// Hono 5 sono @ERROR e @NOT_FOUND. Un `.all("/x")` è una route.
		if (
			r.method.startsWith("@") ||
			(r.method === "ALL" && r.path.endsWith("*"))
		)
			continue;
		const key = `${r.method} ${r.path}`;
		routes.set(key, [...(routes.get(key) ?? []), r.handler as Marked]);
		paths.set(key, r.path);
	}
	const problems: string[] = [];
	for (const [key, handlers] of routes) {
		// Fino al primo handler vero (anche quello di una registrazione doppia
		// dello stesso path, che risponderebbe lui).
		const end = handlers.findIndex(
			(h) => !(h[GUARD] || h[PUBLIC] || h[DOC] || h[VALIDATES]),
		);
		const head = end === -1 ? handlers : handlers.slice(0, end);
		const auth = handlers.findIndex((h) => h[GUARD]);
		const validators = handlers.flatMap((h, i) => {
			const v = h[VALIDATES];
			return v ? [{ i, rank: ORDER[v.target] }] : [];
		});
		const allowed =
			typeof guards === "function" ? guards(paths.get(key) ?? "") : guards;
		if (!head.some((h) => h[GUARD] || h[PUBLIC]))
			problems.push(`${key}: né guardia di auth né publicRoute`);
		else if (
			!head.some((h) =>
				allowed.includes(h[PUBLIC] ? "publicRoute" : (h[GUARD] as GuardTag)),
			)
		)
			problems.push(
				`${key}: manca la guardia del modulo (${allowed.join(" o ")})`,
			);
		if (auth !== -1 && validators.some((v) => v.i > auth))
			problems.push(`${key}: un v() dopo l'auth (422 prima di 401)`);
		if (validators.some((v, n) => n > 0 && v.rank < validators[n - 1].rank))
			problems.push(`${key}: v() fuori ordine (params, query, body)`);
	}
	return problems;
}

/** Lancia se una route non rispetta le regole: l'API non parte. */
export function assertRoutes(app: Hono<any, any, any>, guards: ModuleGuards) {
	const problems = routeProblems(app, guards);
	if (problems.length)
		throw new Error(`Route Hono non valide:\n${problems.join("\n")}`);
}
