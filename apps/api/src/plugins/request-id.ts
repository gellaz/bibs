import { createMiddleware } from "hono/factory";

/**
 * An inbound id is kept only when it looks like an id: it ends up in logs and
 * in the response header, so free text (newlines, very long strings) is
 * replaced by a fresh UUID.
 */
const INBOUND_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export type RequestIdEnv = { Variables: { requestId: string } };

/** `x-request-id` on every response (not on the CORS preflight, answered before). */
export const requestId = createMiddleware<RequestIdEnv>(async (c, next) => {
	const inbound = c.req.header("x-request-id");
	const id =
		inbound && INBOUND_ID.test(inbound) ? inbound : crypto.randomUUID();
	c.set("requestId", id);
	c.res.headers.set("x-request-id", id);
	await next();
});
