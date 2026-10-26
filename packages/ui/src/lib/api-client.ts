import type { ApplyGlobalResponse, ClientResponse } from "hono/client";
import type { SuccessStatusCode } from "hono/utils/http-status";
import { ApiError } from "./api-error";

// Client `hc` dell'API: uno per sotto-albero (sub-app), in `src/lib/api.ts`
// di ogni app.

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
 * `message` del corpo (o `fallback`) e lo status HTTP, così `shouldRetryQuery`
 * e i rami su `status` funzionano. Le date arrivano come stringhe ISO (`hc`
 * non le converte).
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
