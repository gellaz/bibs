import { Elysia } from "elysia";

/**
 * An inbound id is kept only when it looks like an id: it ends up in logs and
 * in the response header, so free text (newlines, very long strings) is
 * replaced by a fresh UUID.
 */
const INBOUND_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestId = new Elysia({ name: "request-id" }).derive(
	{ as: "global" },
	({ request, set }) => {
		const inbound = request.headers.get("x-request-id");
		const id =
			inbound && INBOUND_ID.test(inbound) ? inbound : crypto.randomUUID();
		set.headers["x-request-id"] = id;
		return { requestId: id };
	},
);
