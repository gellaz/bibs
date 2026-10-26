import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { RouteNotFoundError, toErrorResponse } from "./errors";
import { json } from "./send";

/**
 * Il path come lo instradava l'API prima di Hono: grezzo (`/me/%61vatar` non è
 * `/me/avatar`, 404; i parametri li decodifica `c.req.param()`) e con lo slash
 * finale tollerato. Hono di suo decodifica il path prima di instradarlo.
 */
export function rawPath(request: Request) {
	const url = request.url;
	const start = url.indexOf("/", url.indexOf(":") + 4);
	// Solo `?`: `/brands#x` resta un path che non esiste (404), come prima.
	const end = url.indexOf("?", start);
	const path = end === -1 ? url.slice(start) : url.slice(start, end);
	// «//» resta com'è (`/prefisso//` è un 404); tolto uno slash arriverebbe
	// alla route "/" della sub-app.
	return path.length > 2 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** L'inviluppo JSON di ogni errore (D7 del piano Hono). */
export function errorResponse(c: Context) {
	const { status, body } = toErrorResponse(c.error, {
		method: c.req.method,
		path: c.req.path,
	});
	return json(c, body, status as ContentfulStatusCode);
}

/** Il 404 JSON di una richiesta che nessuna route prende. */
export function notFoundResponse(c: Context) {
	const { body } = toErrorResponse(new RouteNotFoundError(), {
		method: c.req.method,
		path: c.req.path,
	});
	return json(c, body, 404);
}

/**
 * La sub-app Hono di un modulo (D7, D8 del piano Hono): errori e 404 con
 * l'inviluppo JSON di sempre, uguale nell'app radice (`src/app.ts`) e da sola
 * nei test; path grezzo con lo slash finale tollerato.
 */
export function moduleApp() {
	return new Hono({ getPath: rawPath })
		.onError(errorResponse)
		.notFound(notFoundResponse);
}
