// PROBE: which wins when a mount prefix overlaps a still-Elysia route.
import { it } from "bun:test";
import { Elysia } from "elysia";
import { Hono } from "hono";

it("overlap: Elysia static route vs mount wildcard on the same prefix", async () => {
	const h = new Hono().all("*", (c) => c.text(`hono ${c.req.path}`));
	const before = new Elysia()
		.mount("/me", h.fetch)
		.get("/me/avatar", () => "elysia");
	const after = new Elysia()
		.get("/me/avatar", () => "elysia")
		.mount("/me", h.fetch);
	const t = (a: { handle: (r: Request) => Promise<Response> }, p: string) =>
		a.handle(new Request(`http://localhost${p}`)).then((r) => r.text());
	console.log("PROBE overlap", {
		mountFirst: [await t(before, "/me/avatar"), await t(before, "/me/other")],
		mountLast: [await t(after, "/me/avatar"), await t(after, "/me/other")],
	});
});
