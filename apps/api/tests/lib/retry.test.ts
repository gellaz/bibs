import { describe, expect, it } from "bun:test";
import { isConnectionError, retry } from "@/lib/retry";

/** Never sleeps, so the retry tests stay instant. */
const noSleep = async () => {};

/** Builds a node-style socket error the way the runtime reports it. */
function socketError(code: string) {
	return Object.assign(new Error(`connect ${code} 127.0.0.1:9000`), { code });
}

describe("isConnectionError", () => {
	it("recognises a bare ECONNREFUSED", () => {
		expect(isConnectionError(socketError("ECONNREFUSED"))).toBe(true);
	});

	it("finds the code nested in a cause chain", () => {
		// The AWS SDK rejects with its own error and keeps the socket failure
		// one or two `cause` hops down — that nesting is why the startup crash
		// surfaced as an opaque node:net trace.
		const wrapped = Object.assign(new Error("connection failure"), {
			cause: Object.assign(new Error("inner"), {
				cause: socketError("ECONNREFUSED"),
			}),
		});

		expect(isConnectionError(wrapped)).toBe(true);
	});

	it("rejects an application-level failure", () => {
		const denied = Object.assign(new Error("Access Denied"), {
			name: "AccessDenied",
			$metadata: { httpStatusCode: 403 },
		});

		expect(isConnectionError(denied)).toBe(false);
	});

	it("terminates on a self-referential cause chain", () => {
		const looping: { cause?: unknown } = new Error("loop");
		looping.cause = looping;

		expect(isConnectionError(looping)).toBe(false);
	});
});

describe("retry", () => {
	it("returns the result once a connection failure clears", async () => {
		let attempts = 0;

		const result = await retry(
			async () => {
				attempts++;
				if (attempts < 3) throw socketError("ECONNREFUSED");
				return "bucket ready";
			},
			{ sleep: noSleep },
		);

		expect(result).toBe("bucket ready");
		expect(attempts).toBe(3);
	});

	it("re-throws the original error once the attempts run out", async () => {
		let attempts = 0;

		const failing = retry(
			async () => {
				attempts++;
				throw socketError("ECONNREFUSED");
			},
			{ attempts: 4, sleep: noSleep },
		);

		await expect(failing).rejects.toMatchObject({ code: "ECONNREFUSED" });
		expect(attempts).toBe(4);
	});

	it("does not retry a failure that is not a connection error", async () => {
		let attempts = 0;

		const failing = retry(
			async () => {
				attempts++;
				throw new Error("Access Denied");
			},
			{ sleep: noSleep },
		);

		await expect(failing).rejects.toThrow("Access Denied");
		expect(attempts).toBe(1);
	});

	it("backs off exponentially between attempts", async () => {
		const delays: number[] = [];

		const failing = retry(
			async () => {
				throw socketError("ECONNREFUSED");
			},
			{
				attempts: 4,
				delayMs: 200,
				sleep: async (ms) => {
					delays.push(ms);
				},
			},
		);

		await expect(failing).rejects.toMatchObject({ code: "ECONNREFUSED" });
		// Three waits for four attempts — none after the last failure.
		expect(delays).toEqual([200, 400, 800]);
	});
});
