import { treaty } from "@elysiajs/eden";
import { createIsomorphicFn } from "@tanstack/react-start";
import type { Elysia } from "elysia";
import type { ApplyGlobalResponse, ClientResponse } from "hono/client";
import type { SuccessStatusCode } from "hono/utils/http-status";
import { ApiError } from "./api-error";

// ── Client `hc` (migrazione Hono: un client per sotto-albero dell'API) ──────

/** Corpo di ogni errore dell'API (`errorBody` dell'API, più `resentAt` del 409). */
export interface ErrorBody {
	success: false;
	error: string;
	message: string;
	resentAt?: string;
}

/**
 * Il tipo di una sub-app dell'API con i corpi di errore dell'inviluppo, che
 * l'API lancia (ServiceError, 422) invece di restituirli: `hc<WithErrors<X>>`.
 */
export type WithErrors<App> = ApplyGlobalResponse<
	App,
	{
		400: { json: ErrorBody };
		401: { json: ErrorBody };
		403: { json: ErrorBody };
		404: { json: ErrorBody };
		409: { json: ErrorBody };
		422: { json: ErrorBody };
		429: { json: ErrorBody };
		500: { json: ErrorBody };
	}
>;

type SuccessJson<R> =
	R extends ClientResponse<infer T, infer S, "json">
		? S extends SuccessStatusCode
			? T
			: never
		: never;

/**
 * Il corpo di una risposta `hc` riuscita; altrimenti lancia un `ApiError` col
 * `message` del corpo (o `fallback`) e lo status HTTP, come `unwrap` con Eden:
 * `shouldRetryQuery` e i rami su `status` non cambiano. Le date arrivano come
 * stringhe ISO (`hc` non le converte).
 */
export async function unwrapJson<R extends ClientResponse<unknown, number>>(
	res: R,
	fallback: string,
): Promise<SuccessJson<R>> {
	if (!res.ok) {
		const body: unknown = await res.json().catch(() => undefined);
		const message =
			body && typeof body === "object" && "message" in body
				? body.message
				: undefined;
		throw new ApiError(
			typeof message === "string" ? message : fallback,
			res.status,
		);
	}
	return (await res.json()) as SuccessJson<R>;
}

// ── Eden Treaty (moduli non ancora migrati) ──────────────────────────────────

export interface CreateApiClientOptions {
	/**
	 * Passato a Eden treaty. Default `true` (comportamento storico): Eden
	 * revivifica ogni stringa JSON che somiglia a una data (dd/mm/yyyy,
	 * dd-mm-yyyy, yyyy-mm-dd, ISO datetime) in un oggetto `Date`. Va disattivato
	 * per un fetch che può contenere testo libero simile a una data (es. una
	 * caratteristica di testo "05/03/2027"), altrimenti Eden la trasforma in
	 * silenzio in un `Date` sbagliato.
	 */
	parseDate?: boolean;
}

/**
 * Eden Treaty client isomorfo per TanStack Start, parametrizzato sul tipo `App`
 * del backend (così `@bibs/ui` non dipende da `@bibs/api`: ogni app passa il
 * proprio `App`).
 *
 * - **Server (SSR/loaders)**: chiama l'API direttamente via HTTP interno
 * - **Client (browser)**: chiama l'API via HTTP dal browser
 *
 * Entrambi usano `credentials: "include"` per i cookie di autenticazione.
 */
export function createApiClient<
	App extends Elysia<any, any, any, any, any, any, any>,
>(apiUrl: string, options?: CreateApiClientOptions) {
	const parseDate = options?.parseDate ?? true;
	return createIsomorphicFn()
		.server(() =>
			treaty<App>(apiUrl, {
				fetch: { credentials: "include" as RequestCredentials },
				parseDate,
			}),
		)
		.client(() =>
			treaty<App>(apiUrl, {
				fetch: { credentials: "include" as RequestCredentials },
				parseDate,
			}),
		);
}

// Eden responses are { data, error }; the error shape is per-route, so narrow
// it at runtime. Covers both message shapes seen across the app: a string
// `value`, or a `{ message }` object `value`.
export function edenMessage(error: unknown): string | undefined {
	if (error && typeof error === "object" && "value" in error) {
		const v = (error as { value?: unknown }).value;
		if (typeof v === "string") return v;
		if (v && typeof v === "object" && "message" in v) {
			const m = (v as { message?: unknown }).message;
			if (typeof m === "string") return m;
		}
	}
	return undefined;
}

/**
 * Unwraps an already-awaited Eden response: throws `edenMessage(res.error) ??
 * fallback` if it errored (an `ApiError` carrying the HTTP status when Eden
 * reports one), otherwise returns the payload (`res.data`). Callers keep any
 * trailing `.data` drill they already had.
 */
export function unwrap<T>(
	res: { data: T | null; error: unknown },
	fallback: string,
): T {
	if (res.error) {
		const message = edenMessage(res.error) ?? fallback;
		const status = (res.error as { status?: unknown }).status;
		throw typeof status === "number"
			? new ApiError(message, status)
			: new Error(message);
	}
	if (res.data == null) throw new Error(fallback);
	return res.data;
}
