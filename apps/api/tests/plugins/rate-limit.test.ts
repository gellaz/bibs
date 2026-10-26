import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { rootApp } from "@/app";
import { moduleApp } from "@/http/app";
import { v } from "@/http/validator";
import { clientIp, rateLimit } from "@/plugins/rate-limit";

// Tests simulate being behind a trusted proxy so X-Forwarded-For is honoured.
function ipApp() {
	return moduleApp().get(
		"/limited",
		rateLimit({
			name: "test-ip",
			trustProxy: true,
			limits: [{ by: "ip", window: 10_000, max: 2 }],
		}),
		(c) => c.json({ success: true, data: "ok" }),
	);
}

function emailApp() {
	return moduleApp().post(
		"/limited",
		v("json", z.object({ email: z.string() })),
		rateLimit({
			name: "test-email",
			trustProxy: true,
			limits: [{ by: "email", window: 10_000, max: 2 }],
		}),
		(c) => c.json({ success: true, data: "ok" }),
	);
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

		expect((await app.request(reqIp("1.1.1.1"))).status).toBe(200);
		expect((await app.request(reqIp("1.1.1.1"))).status).toBe(200);

		const blocked = await app.request(reqIp("1.1.1.1"));
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("retry-after")).toBeString();

		const body = (await blocked.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.error).toBe("TOO_MANY_REQUESTS");
	});

	it("keeps limits independent per client IP", async () => {
		const app = ipApp();

		await app.request(reqIp("2.2.2.2"));
		await app.request(reqIp("2.2.2.2"));
		expect((await app.request(reqIp("2.2.2.2"))).status).toBe(429);

		// A different IP is unaffected.
		expect((await app.request(reqIp("3.3.3.3"))).status).toBe(200);
	});
});

describe("rateLimit — email keyed", () => {
	it("limits per email address regardless of how the body is sent", async () => {
		const app = emailApp();

		expect((await app.request(reqEmail("a@x.it"))).status).toBe(200);
		expect((await app.request(reqEmail("a@x.it"))).status).toBe(200);
		expect((await app.request(reqEmail("a@x.it"))).status).toBe(429);

		// A different email gets its own bucket.
		expect((await app.request(reqEmail("b@x.it"))).status).toBe(200);
	});
});

describe("rateLimit — stacked ip + email rules (the real /sign-in shape)", () => {
	function signInApp() {
		return moduleApp().post(
			"/limited",
			v("json", z.object({ email: z.string() })),
			rateLimit({
				name: "test-sign-in",
				trustProxy: true,
				limits: [
					{ by: "ip", window: 60_000, max: 5 },
					{ by: "email", window: 60_000, max: 2 },
				],
			}),
			(c) => c.json({ success: true, data: "ok" }),
		);
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

		expect(
			(await app.request(signInReq("9.9.9.9", "victim@x.it"))).status,
		).toBe(200);
		expect(
			(await app.request(signInReq("9.9.9.9", "victim@x.it"))).status,
		).toBe(200);
		// 3rd hit on the same email trips the email cap (max 2), well under the IP cap (max 5).
		expect(
			(await app.request(signInReq("9.9.9.9", "victim@x.it"))).status,
		).toBe(429);

		// A different email from the same IP is still allowed (IP cap not reached).
		expect((await app.request(signInReq("9.9.9.9", "other@x.it"))).status).toBe(
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

// D12 del piano Hono. Su un server vero (`Bun.serve({ fetch: app.fetch })`)
// il server di Bun arriva a Hono come `env` e l'IP è quello del socket; senza
// socket (`app.request`, i test, la CLI) vale il primo `x-forwarded-for`, così
// due client diversi non finiscono nello stesso bucket "unknown".
describe("rateLimit — IP dal socket, e senza socket", () => {
	const limited = () =>
		moduleApp().get(
			"/limited",
			rateLimit({
				name: "test-mount",
				trustProxy: false,
				limits: [{ by: "ip", window: 10_000, max: 2 }],
			}),
			(c) => c.json({ success: true, data: "ok" }),
		);

	it("due x-forwarded-for diversi finiscono in bucket diversi", async () => {
		const app = limited();

		expect((await app.request(reqIp("4.4.4.4"))).status).toBe(200);
		expect((await app.request(reqIp("4.4.4.4"))).status).toBe(200);
		expect((await app.request(reqIp("4.4.4.4"))).status).toBe(429);
		expect((await app.request(reqIp("5.5.5.5"))).status).toBe(200);
	});

	it("su un socket vero un x-forwarded-for falsificato non apre un bucket nuovo", async () => {
		const app = rootApp().route("/rl", limited());
		const server = Bun.serve({ port: 0, fetch: app.fetch });
		const url = `http://localhost:${server.port}/rl/limited`;
		const spoofed = (ip: string) =>
			fetch(url, { headers: { "x-forwarded-for": ip } });
		try {
			expect((await spoofed("1.1.1.1")).status).toBe(200);
			expect((await spoofed("2.2.2.2")).status).toBe(200);
			expect((await spoofed("3.3.3.3")).status).toBe(429);
			// Il bucket pieno è quello del socket, non "unknown": senza socket
			// (app.request, nessun x-forwarded-for) la richiesta passa.
			const noSocket = await app.request(
				new Request("http://localhost/rl/limited"),
			);
			expect(noSocket.status).toBe(200);
		} finally {
			await server.stop(true);
		}
	});
});
