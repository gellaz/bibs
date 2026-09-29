import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { requestId } from "@/plugins/request-id";

const app = new Elysia().use(requestId).get("/", ({ requestId }) => requestId);

async function call(header?: string) {
	const res = await app.handle(
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
		const { header, body } = await call("edge-abc_123.4");
		expect(header).toBe("edge-abc_123.4");
		expect(body).toBe("edge-abc_123.4");
	});

	it("replaces an inbound id that is not id-shaped", async () => {
		for (const bad of ["has space", "x".repeat(129), ""]) {
			const { header } = await call(bad);
			expect(header).not.toBe(bad);
			expect(header).toMatch(/^[0-9a-f-]{36}$/);
		}
	});
});
