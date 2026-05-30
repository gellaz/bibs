import { describe, expect, it } from "bun:test";
import { consume, type RateLimitStore } from "@/plugins/rate-limit";

describe("consume — fixed-window rate limit", () => {
	it("allows requests up to the max within the window", () => {
		const store: RateLimitStore = new Map();
		for (let i = 0; i < 3; i++) {
			expect(consume(store, "k", 1000, 3, 0).allowed).toBe(true);
		}
	});

	it("blocks the request once the max is exceeded and reports retryAfter in seconds", () => {
		const store: RateLimitStore = new Map();
		for (let i = 0; i < 3; i++) consume(store, "k", 10_000, 3, 0);

		const blocked = consume(store, "k", 10_000, 3, 5_000);

		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfter).toBe(5); // (10000 - 5000) / 1000
	});

	it("resets the counter after the window elapses", () => {
		const store: RateLimitStore = new Map();
		for (let i = 0; i < 3; i++) consume(store, "k", 1000, 3, 0);

		// now === resetAt → window elapsed, fresh allowance
		expect(consume(store, "k", 1000, 3, 1000).allowed).toBe(true);
	});

	it("keeps counters independent per key", () => {
		const store: RateLimitStore = new Map();
		consume(store, "a", 1000, 1, 0);

		expect(consume(store, "a", 1000, 1, 0).allowed).toBe(false);
		expect(consume(store, "b", 1000, 1, 0).allowed).toBe(true);
	});
});
