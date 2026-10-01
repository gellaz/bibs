import { describe, expect, it } from "vitest";
import { ApiError } from "~/lib/api-error";
import { shouldRetryQuery } from "~/lib/query-retry";

describe("shouldRetryQuery", () => {
	it("never retries a definitive client error", () => {
		for (const status of [400, 401, 403, 404, 409, 422]) {
			expect(shouldRetryQuery(0, new ApiError("x", status))).toBe(false);
		}
	});

	it("retries server errors and network failures up to 3 times", () => {
		expect(shouldRetryQuery(0, new ApiError("x", 502))).toBe(true);
		expect(shouldRetryQuery(2, new Error("network"))).toBe(true);
		expect(shouldRetryQuery(3, new Error("network"))).toBe(false);
	});
});
