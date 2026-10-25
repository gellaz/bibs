import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { ResponseValidationError } from "./errors";

/** Il Content-Type JSON di Elysia: i client vedono lo stesso header. */
export const JSON_UTF8 = { "Content-Type": "application/json;charset=utf-8" };

/** `c.json` con il Content-Type di Elysia, per gli inviluppi di errore. */
export const json = <T, S extends ContentfulStatusCode>(
	c: Context,
	body: T,
	status: S,
) => c.json(body, status, JSON_UTF8);

/**
 * Risposta di successo validata dallo schema (D4 del piano Hono), come la
 * `response` di Elysia: i campi fuori schema spariscono a ogni profondità
 * (colonne interne), i `Date` escono come stringhe ISO, e un dato che non
 * rispetta lo schema è un bug nostro → 500 «Errore interno del server».
 * `hc` tipizza la risposta dallo schema.
 */
export function send<S extends z.ZodType>(
	c: Context,
	schema: S,
	data: z.input<S>,
) {
	const result = schema.safeParse(data);
	if (!result.success) {
		const path = result.error.issues[0]?.path ?? [];
		throw new ResponseValidationError(path.length ? `/${path.join("/")}` : "");
	}
	return json(c, result.data as z.output<S>, 200);
}
