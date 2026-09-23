import { treaty } from "@elysiajs/eden";
import { createIsomorphicFn } from "@tanstack/react-start";
import type { Elysia } from "elysia";

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
 * fallback` if it errored, otherwise returns the payload (`res.data`). Callers
 * keep any trailing `.data` drill they already had.
 */
export function unwrap<T>(
	res: { data: T | null; error: unknown },
	fallback: string,
): T {
	if (res.error) throw new Error(edenMessage(res.error) ?? fallback);
	if (res.data == null) throw new Error(fallback);
	return res.data;
}
