import type { ClientResponse } from "hono/client";
import { describe, expect, it } from "vitest";
import { unwrapJson } from "./api-client";
import { ApiError } from "./api-error";

const response = (body: string, status: number) =>
	new Response(body, {
		status,
		headers: { "content-type": "application/json" },
	}) as unknown as ClientResponse<{ ok: true }, 200, "json">;

describe("unwrapJson", () => {
	it("restituisce il corpo di una risposta riuscita", async () => {
		await expect(
			unwrapJson(response('{"ok":true}', 200), "x"),
		).resolves.toEqual({
			ok: true,
		});
	});

	it("lancia ApiError col message dell'inviluppo e lo status", async () => {
		const res = response(
			'{"success":false,"error":"UNAUTHORIZED","message":"Devi accedere per continuare"}',
			401,
		);
		const error = await unwrapJson(res, "fallback").catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			message: "Devi accedere per continuare",
			status: 401,
		});
	});

	it("usa il fallback se il corpo non ha un message", async () => {
		const error = await unwrapJson(response("oops", 502), "fallback").catch(
			(e) => e,
		);
		expect(error).toMatchObject({ message: "fallback", status: 502 });
	});
});
