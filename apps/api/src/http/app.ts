import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { RouteNotFoundError, toErrorResponse } from "./errors";
import { json } from "./send";

/**
 * Il path come lo instrada Elysia: grezzo (`/me/%61vatar` non è `/me/avatar`,
 * 404; i parametri li decodifica `c.req.param()`) e con lo slash finale
 * tollerato. Hono di suo decodifica il path prima di instradarlo.
 */
function rawPath(request: Request) {
	const url = request.url;
	const start = url.indexOf("/", url.indexOf(":") + 4);
	const end = url.slice(start).search(/[?#]/);
	const path = end === -1 ? url.slice(start) : url.slice(start, start + end);
	return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * La sub-app Hono di un modulo (D7, D8 del piano Hono): errori e 404 con
 * l'inviluppo JSON di sempre, uguale montata in Elysia e da sola nei test;
 * path grezzo con lo slash finale tollerato, come Elysia.
 */
export function moduleApp() {
	return new Hono({ getPath: rawPath })
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
