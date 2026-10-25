// Route metadata straight from a Hono app: v() and doc() carry their schemas on the
// middleware function; app.routes lists every handler of the chain.
import "../tests/preload";
import { Hono, type MiddlewareHandler } from "hono";
import { generatePaths, type RouteDoc } from "@/lib/openapi-gen";
import {
	DiscountCreateBody,
	DiscountListItemSchema,
	DiscountListQuery,
	DiscountSchema,
	okPageRes,
	okRes,
	withErrors,
} from "@/lib/schemas";
import { v } from "@/lib/validate";

type Meta = Partial<RouteDoc>;
const doc = (meta: Meta): MiddlewareHandler =>
	Object.assign(async (_c: unknown, next: () => Promise<void>) => next(), {
		openapi: meta,
	});
const withSchema = <M extends MiddlewareHandler>(
	mw: M,
	target: string,
	schema: unknown,
) =>
	Object.assign(mw, {
		openapi: {
			[target === "json" || target === "form"
				? "body"
				: target === "param"
					? "params"
					: target]: schema,
		},
	});

const app = new Hono()
	.get(
		"/seller/discounts",
		doc({
			response: withErrors({ 200: okPageRes(DiscountListItemSchema) }),
			detail: {
				summary: "Lista promozioni",
				description:
					"Elenca le promozioni del venditore. Filtro 'state': 'assignable' (in corso/programmate/in pausa, default) o 'concluded' (scadute/archiviate).",
				tags: ["Seller - Discounts"],
				security: [{ bearerAuth: [] }],
			},
		}),
		withSchema(v("query", DiscountListQuery), "query", DiscountListQuery),
		(c) => c.json(null),
	)
	.post(
		"/seller/discounts",
		doc({ response: withErrors({ 200: okRes(DiscountSchema) }) }),
		withSchema(v("json", DiscountCreateBody), "json", DiscountCreateBody),
		(c) => c.json(null),
	);

const byRoute = new Map<string, RouteDoc>();
for (const r of app.routes) {
	const key = `${r.method} ${r.path}`;
	const doc = byRoute.get(key) ?? { method: r.method, path: r.path };
	Object.assign(doc, (r.handler as { openapi?: Meta }).openapi);
	byRoute.set(key, doc);
}
console.log(
	"app.routes entries:",
	app.routes.length,
	"→ operations:",
	byRoute.size,
);
const paths = generatePaths([...byRoute.values()]);
const cold = (await Bun.file(`${process.env.OUT_DIR}/openapi-cold.json`).json())
	.paths["/seller/discounts"].get;
const canon = (x: any): any =>
	Array.isArray(x)
		? x.map(canon)
		: x && typeof x === "object"
			? Object.fromEntries(
					Object.keys(x)
						.sort()
						.map((k) => [k, canon(x[k])]),
				)
			: x;
console.log(
	"GET /seller/discounts from Hono app.routes identical to Elysia cold spec:",
	JSON.stringify(canon(cold)) ===
		JSON.stringify(canon(paths["/seller/discounts"].get)),
);
