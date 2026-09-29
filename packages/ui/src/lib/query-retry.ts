import { ApiError } from "./api-error";

const MAX_RETRIES = 3;

/**
 * Retry di default delle query: un 4xx è definitivo (riprovarlo ripete solo lo
 * stesso errore, e ritarda di secondi il suo stato), un 5xx o un errore di
 * rete si riprova come il default di TanStack Query.
 */
export function shouldRetryQuery(failureCount: number, error: unknown) {
	if (error instanceof ApiError && error.status >= 400 && error.status < 500)
		return false;
	return failureCount < MAX_RETRIES;
}
