import { describe, expect, it } from "bun:test";
import { rootApp } from "@/app";

// `hono/request-id` come lo registra l'app radice.
const app = rootApp().get("/", (c) => c.text(c.var.requestId));

async function call(header?: string) {
	const res = await app.request(
		new Request("http://localhost/", {
			headers: header === undefined ? {} : { "x-request-id": header },
		}),
	);
	return { header: res.headers.get("x-request-id"), body: await res.text() };
}

describe("requestId", () => {
	it("generates a UUID when the request has none", async () => {
		const { header, body } = await call();
		expect(header).toMatch(/^[0-9a-f-]{36}$/);
		expect(body).toBe(header as string);
	});

	it("keeps a well-formed inbound id", async () => {
		const { header, body } = await call("edge-abc_123=");
		expect(header).toBe("edge-abc_123=");
		expect(body).toBe("edge-abc_123=");
	});

	it("replaces an inbound id that is not id-shaped", async () => {
		for (const bad of ["has space", "edge.1", "x".repeat(256), ""]) {
			const { header } = await call(bad);
			expect(header).not.toBe(bad);
			expect(header).toMatch(/^[0-9a-f-]{36}$/);
		}
	});
});
