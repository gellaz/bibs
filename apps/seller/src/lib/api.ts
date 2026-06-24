import type { App } from "@bibs/api";
import { treaty } from "@elysiajs/eden";
import { createIsomorphicFn } from "@tanstack/react-start";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Eden Treaty client isomorfo per TanStack Start.
 *
 * - **Server (SSR/loaders)**: chiama l'API direttamente via HTTP interno
 * - **Client (browser)**: chiama l'API via HTTP dal browser
 *
 * Entrambi usano `credentials: "include"` per i cookie di autenticazione.
 */
export const api = createIsomorphicFn()
	.server(() =>
		treaty<App>(API_URL, {
			fetch: { credentials: "include" as RequestCredentials },
		}),
	)
	.client(() =>
		treaty<App>(API_URL, {
			fetch: { credentials: "include" as RequestCredentials },
		}),
	);

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
