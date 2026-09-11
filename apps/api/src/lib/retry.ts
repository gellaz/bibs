/**
 * Retry helpers for startup-time connections to local infrastructure.
 *
 * Docker Compose reports a container as ready as soon as it reaches the
 * "running" state. For a service without a healthcheck — MinIO, whose image
 * ships no curl/wget/nc/mc to probe with — that happens a beat before the
 * process actually binds its port (measured locally at ~60ms). A connection
 * fired right after `docker compose up --wait` can lose that race, so the
 * startup checks retry socket failures instead of crashing on the first one.
 */

/** Socket-level failures meaning "not listening yet", not "request rejected". */
const CONNECTION_ERROR_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENOTFOUND",
	"EPIPE",
	"ETIMEDOUT",
]);

/** How far down a `cause` chain to look before giving up. */
const MAX_CAUSE_DEPTH = 10;

/**
 * True when `err`, or anything in its `cause` chain, is a socket-level
 * connection failure. The AWS SDK rejects with its own error and keeps the
 * original node error nested underneath, so the code is rarely on the surface.
 */
export function isConnectionError(err: unknown): boolean {
	let current: unknown = err;

	for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth++) {
		const code = (current as { code?: unknown }).code;
		if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) {
			return true;
		}

		const cause = (current as { cause?: unknown }).cause;
		current = cause === current ? null : cause;
	}

	return false;
}

export type RetryOptions = {
	/** Total attempts, including the first. Clamped to at least 1. */
	attempts?: number;
	/** Delay before the first retry; doubles on each subsequent one. */
	delayMs?: number;
	/** Which failures are worth another attempt. */
	shouldRetry?: (err: unknown) => boolean;
	/** Injectable so tests don't spend real time asleep. */
	sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying with exponential backoff while `shouldRetry` accepts the
 * failure. Re-throws the last error untouched once the attempts run out, so
 * the caller still gets the real cause to inspect.
 */
export async function retry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const {
		attempts = 5,
		delayMs = 200,
		shouldRetry = isConnectionError,
		sleep = wait,
	} = options;

	const total = Math.max(1, attempts);

	for (let attempt = 1; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (attempt >= total || !shouldRetry(err)) throw err;
			await sleep(delayMs * 2 ** (attempt - 1));
		}
	}
}
