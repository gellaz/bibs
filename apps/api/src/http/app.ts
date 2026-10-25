import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { RouteNotFoundError, toErrorResponse } from "./errors";
import { json } from "./send";

/**
 * La sub-app Hono di un modulo (D7, D8 del piano Hono): errori e 404 con
 * l'inviluppo JSON di sempre, uguale montata in Elysia e da sola nei test;
 * `strict: false` perché Elysia tollera lo slash finale.
 */
export function moduleApp() {
	return new Hono({ strict: false })
		.onError((c) => {
			const { status, body } = toErrorResponse(c.error, {
				method: c.req.method,
				path: c.req.path,
			});
			return json(c, body, status as ContentfulStatusCode);
		})
		.notFound((c) => {
			const { body } = toErrorResponse(new RouteNotFoundError(), {
				method: c.req.method,
				path: c.req.path,
			});
			return json(c, body, 404);
		});
}
