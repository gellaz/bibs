import { describe, expect, it } from "bun:test";
import { Elysia, t } from "elysia";
import { clientIp, rateLimit } from "@/plugins/rate-limit";

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as const;

// Tests simulate being behind a trusted proxy so X-Forwarded-For is honoured.
function ipApp() {
	return new Elysia()
		.state("pino", noopPino)
		.get("/limited", () => ({ success: true, data: "ok" }), {
			beforeHandle: rateLimit({
				name: "test-ip",
				trustProxy: true,
				limits: [{ by: "ip", window: 10_000, max: 2 }],
			}),
		});
}

function emailApp() {
	return new Elysia()
		.state("pino", noopPino)
		.post("/limited", () => ({ success: true, data: "ok" }), {
			body: t.Object({ email: t.String() }),
			beforeHandle: rateLimit({
				name: "test-email",
				trustProxy: true,
				limits: [{ by: "email", window: 10_000, max: 2 }],
			}),
		});
}

function reqIp(ip: string) {
	return new Request("http://localhost/limited", {
		headers: { "x-forwarded-for": ip },
	});
}

function reqEmail(email: string) {
	return new Request("http://localhost/limited", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email }),
	});
}

describe("rateLimit — IP keyed", () => {
	it("allows requests up to the max then returns 429 with Retry-After", async () => {
		const app = ipApp();

		expect((await app.handle(reqIp("1.1.1.1"))).status).toBe(200);
		expect((await app.handle(reqIp("1.1.1.1"))).status).toBe(200);

		const blocked = await app.handle(reqIp("1.1.1.1"));
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("retry-after")).toBeString();

		const body = (await blocked.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.error).toBe("TOO_MANY_REQUESTS");
	});

	it("keeps limits independent per client IP", async () => {
		const app = ipApp();

		await app.handle(reqIp("2.2.2.2"));
		await app.handle(reqIp("2.2.2.2"));
		expect((await app.handle(reqIp("2.2.2.2"))).status).toBe(429);

		// A different IP is unaffected.
		expect((await app.handle(reqIp("3.3.3.3"))).status).toBe(200);
	});
});

describe("rateLimit — email keyed", () => {
	it("limits per email address regardless of how the body is sent", async () => {
		const app = emailApp();

		expect((await app.handle(reqEmail("a@x.it"))).status).toBe(200);
		expect((await app.handle(reqEmail("a@x.it"))).status).toBe(200);
		expect((await app.handle(reqEmail("a@x.it"))).status).toBe(429);

		// A different email gets its own bucket.
		expect((await app.handle(reqEmail("b@x.it"))).status).toBe(200);
	});
});

describe("rateLimit — stacked ip + email rules (the real /sign-in shape)", () => {
	function signInApp() {
		return new Elysia()
			.state("pino", noopPino)
			.post("/limited", () => ({ success: true, data: "ok" }), {
				body: t.Object({ email: t.String() }),
				beforeHandle: rateLimit({
					name: "test-sign-in",
					trustProxy: true,
					limits: [
						{ by: "ip", window: 60_000, max: 5 },
						{ by: "email", window: 60_000, max: 2 },
					],
				}),
			});
	}

	function signInReq(ip: string, email: string) {
		return new Request("http://localhost/limited", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-for": ip },
			body: JSON.stringify({ email }),
		});
	}

	it("blocks on the email cap before the IP cap when one email is hammered from one IP", async () => {
		const app = signInApp();

		expect((await app.handle(signInReq("9.9.9.9", "victim@x.it"))).status).toBe(
			200,
		);
		expect((await app.handle(signInReq("9.9.9.9", "victim@x.it"))).status).toBe(
			200,
		);
		// 3rd hit on the same email trips the email cap (max 2), well under the IP cap (max 5).
		expect((await app.handle(signInReq("9.9.9.9", "victim@x.it"))).status).toBe(
			429,
		);

		// A different email from the same IP is still allowed (IP cap not reached).
		expect((await app.handle(signInReq("9.9.9.9", "other@x.it"))).status).toBe(
			200,
		);
	});
});

describe("clientIp", () => {
	const fakeServer = (address: string) => ({
		requestIP: () => ({ address }),
	});

	it("uses the first X-Forwarded-For hop when proxy is trusted", () => {
		const req = new Request("http://x/", {
			headers: { "x-forwarded-for": "9.9.9.9, 1.1.1.1" },
		});
		expect(clientIp(req, fakeServer("10.0.0.1"), true)).toBe("9.9.9.9");
	});

	it("ignores X-Forwarded-For and uses the socket address when proxy is NOT trusted", () => {
		const req = new Request("http://x/", {
			headers: { "x-forwarded-for": "9.9.9.9" },
		});
		expect(clientIp(req, fakeServer("10.0.0.1"), false)).toBe("10.0.0.1");
	});

	it("falls back to 'unknown' when no socket address is available", () => {
		const req = new Request("http://x/", {
			headers: { "x-forwarded-for": "9.9.9.9" },
		});
		expect(clientIp(req, null, false)).toBe("unknown");
	});
});
