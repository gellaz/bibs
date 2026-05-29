import type { HTTPHeaders } from "elysia";
import { env } from "@/lib/env";
import { getLogger } from "@/lib/logger";

export interface RateLimitBucket {
	count: number;
	resetAt: number;
}

export type RateLimitStore = Map<string, RateLimitBucket>;

export interface ConsumeResult {
	allowed: boolean;
	/** Seconds until the window resets (0 when allowed). */
	retryAfter: number;
}

/**
 * Fixed-window counter. Pure and side-effect-free beyond mutating the passed
 * store, so it can be unit-tested with an injected `now`.
 */
export function consume(
	store: RateLimitStore,
	key: string,
	window: number,
	max: number,
	now: number,
): ConsumeResult {
	const bucket = store.get(key);

	if (!bucket || now >= bucket.resetAt) {
		store.set(key, { count: 1, resetAt: now + window });
		return { allowed: true, retryAfter: 0 };
	}

	if (bucket.count < max) {
		bucket.count += 1;
		return { allowed: true, retryAfter: 0 };
	}

	return {
		allowed: false,
		retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
	};
}

// ── Elysia beforeHandle factory ─────────────────────

export interface RateLimitRule {
	/** `ip` keys on the client IP; `email` keys on the request body's `email`. */
	by: "ip" | "email";
	/** Window length in milliseconds. */
	window: number;
	/** Max requests allowed per key within the window. */
	max: number;
}

export interface RateLimitOptions {
	/** Namespace for this limiter's keys (also logged on a 429). */
	name: string;
	limits: RateLimitRule[];
	message?: string;
	/**
	 * Whether to trust the client-supplied `X-Forwarded-For` header for the IP key.
	 * Defaults to `env.TRUST_PROXY === "true"`. Leave false unless a reverse proxy
	 * you control sets the header, otherwise a client can spoof it to dodge limits.
	 */
	trustProxy?: boolean;
}

/** Minimal structural type for Bun's `server` (avoids its generic signature). */
interface RequestIpResolver {
	requestIP(request: Request): { address: string } | null;
}

/** Minimal slice of the Elysia context the limiter reads. */
interface RateLimitContext {
	request: Request;
	body: unknown;
	server: RequestIpResolver | null;
	set: { status?: number | string; headers: HTTPHeaders };
	store: unknown;
}

const SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_MESSAGE = "Troppe richieste. Riprova più tardi.";

// Registry of every limiter's store, so tests can reset state between cases
// (production never calls the reset). Keeps each limiter's store private otherwise.
const allStores: RateLimitStore[] = [];

/** Test-only: clear all rate-limit buckets so cases don't bleed into each other. */
export function __clearRateLimitStores(): void {
	for (const store of allStores) store.clear();
}

export function clientIp(
	request: Request,
	server: RequestIpResolver | null,
	trustProxy: boolean,
): string {
	// Only honour X-Forwarded-For behind a trusted proxy — otherwise a direct
	// client can spoof it per request and land in a fresh bucket every time.
	if (trustProxy) {
		const forwarded = request.headers.get("x-forwarded-for");
		if (forwarded) return forwarded.split(",")[0].trim();
	}
	return server?.requestIP(request)?.address ?? "unknown";
}

function emailKey(body: unknown): string {
	const email = (body as { email?: unknown } | null | undefined)?.email;
	return typeof email === "string" ? email.toLowerCase() : "anonymous";
}

/**
 * Returns an Elysia `beforeHandle` hook that throttles a route. better-auth's own
 * rate limiter does not cover our server-side `auth.api.*` calls, so we guard the
 * registration / sign-in routes here. Each call gets its own in-memory store, so
 * limits reset on restart and are not shared across instances (acceptable for the
 * current single-instance dev stage; swap the store for Redis to scale out).
 */
export function rateLimit(options: RateLimitOptions) {
	const store: RateLimitStore = new Map();
	allStores.push(store);
	const trustProxy = options.trustProxy ?? env.TRUST_PROXY === "true";
	let lastSweep = 0;

	return (ctx: RateLimitContext) => {
		const now = Date.now();

		// Opportunistic, timer-free cleanup of expired buckets to bound memory.
		// Also sweep when the store grows large, so a burst of distinct keys can't
		// balloon memory between the 60s timed sweeps.
		if (now - lastSweep >= SWEEP_INTERVAL_MS || store.size > 10_000) {
			lastSweep = now;
			for (const [key, bucket] of store) {
				if (now >= bucket.resetAt) store.delete(key);
			}
		}

		const ip = clientIp(ctx.request, ctx.server, trustProxy);

		for (const rule of options.limits) {
			const identity = rule.by === "email" ? emailKey(ctx.body) : ip;
			const key = `${options.name}:${rule.by}:${identity}`;
			const result = consume(store, key, rule.window, rule.max, now);

			if (!result.allowed) {
				getLogger(ctx.store)?.warn(
					{
						errorCode: "TOO_MANY_REQUESTS",
						limiter: options.name,
						by: rule.by,
						ip,
						retryAfter: result.retryAfter,
					},
					"Rate limit exceeded",
				);
				ctx.set.status = 429;
				ctx.set.headers["retry-after"] = String(result.retryAfter);
				return {
					success: false as const,
					error: "TOO_MANY_REQUESTS" as const,
					message: options.message ?? DEFAULT_MESSAGE,
				};
			}
		}

		return undefined;
	};
}
