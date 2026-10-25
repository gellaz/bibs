// "After": Hono + TypeBox 1 with the ported schemas (src-tb1, only imports changed).
// Run: bun --tsconfig-override=tsconfig.tb1.json src-tb1/probe-after.ts
import "../tests/preload";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ServiceError } from "@/lib/errors";
import { PaginationQuery } from "@/lib/pagination";
import { ProductSearchQuery } from "@/lib/queries";
import {
	DiscountCreateBody,
	DiscountListQuery,
	okRes,
	withErrors,
} from "@/lib/schemas";
import { t } from "@/lib/t";
import {
	InvalidFileTypeError,
	RequestValidationError,
	ResponseValidationError,
	send,
	v,
} from "@/lib/validate";
import {
	invalidFileTypeMessage,
	validationMessage,
} from "@/lib/validation-message";
import { cases, toRequest } from "../probe/cases";
import { describeValue, echoCases } from "../probe/echo-cases";

const errorBody = (error: string, message: string) => ({
	success: false as const,
	error,
	message,
});

// Port of plugins/error-handler.ts, only the branches the probe exercises (+ the new error classes).
export function toErrorResponse(err: unknown, c: Context) {
	if (err instanceof ServiceError)
		return c.json(errorBody(err.code, err.message), err.status as 400);
	if (err instanceof RequestValidationError)
		return c.json(errorBody("VALIDATION_ERROR", validationMessage(err)), 422);
	if (err instanceof InvalidFileTypeError)
		return c.json(
			errorBody("VALIDATION_ERROR", invalidFileTypeMessage(err.property)),
			422,
		);
	if (err instanceof ResponseValidationError)
		return c.json(
			errorBody("INTERNAL_ERROR", "Errore interno del server"),
			500,
		);
	// Elysia answers malformed JSON with the catch-all 500 (probe/before.ts: reg-malformed-json).
	if (err instanceof HTTPException)
		return c.json(
			errorBody("INTERNAL_ERROR", "Errore interno del server"),
			500,
		);
	return c.json(errorBody("INTERNAL_ERROR", "Errore interno del server"), 500);
}

// Elysia's auth macro is a `resolve`: it runs AFTER validation (422 before 401).
const auth = async (_c: Context, _next: () => Promise<void>) => {
	throw new ServiceError(401, "Devi accedere per continuare");
};

const RegisterBody = t.Object({
	email: t.String({ format: "email", description: "Indirizzo email" }),
	password: t.String({ minLength: 8, maxLength: 128 }),
});
const RespSchema = okRes(
	t.Object({
		id: t.String(),
		createdAt: t.Date(),
		note: t.Nullable(t.String()),
		nested: t.Object({ a: t.Integer() }),
		list: t.Array(t.Object({ b: t.String() })),
	}),
);
const row = {
	id: "1",
	createdAt: new Date("2026-01-01T00:00:00Z"),
	note: null,
	passwordHash: "SECRET",
	nested: { a: 1, internal: "x" },
	list: [{ b: "y", internal: "z" }],
};

export const app = new Hono()
	.post("/register/customer", v("json", RegisterBody), (c) =>
		c.json({ ok: c.req.valid("json").email }),
	)
	.post("/seller/discounts", v("json", DiscountCreateBody), auth, (c) =>
		c.json(null),
	)
	.get("/seller/discounts", v("query", DiscountListQuery), auth, (c) =>
		c.json(null),
	)
	.get("/customer/products", v("query", ProductSearchQuery), (c) =>
		c.json(describeValue(c.req.valid("query"))),
	)
	// echo
	.post("/echo/discount", v("json", DiscountCreateBody), (c) =>
		c.json(describeValue(c.req.valid("json")) as Record<string, string>),
	)
	.get("/echo/products", v("query", ProductSearchQuery), (c) =>
		c.json(describeValue(c.req.valid("query")) as Record<string, string>),
	)
	.get(
		"/echo/param/:n",
		v("param", t.Object({ n: t.Integer() })),
		v("query", PaginationQuery),
		(c) =>
			c.json(
				describeValue({
					params: c.req.valid("param"),
					query: c.req.valid("query"),
				}) as Record<string, string>,
			),
	)
	.get("/echo/resp", (c) =>
		send(c, RespSchema, { success: true, data: row, leak: true } as never),
	)
	.get("/echo/resp-invalid", (c) =>
		send(c, RespSchema, { success: true, data: { id: 1 } } as never),
	)
	.get("/echo/resp-404", () => {
		throw new ServiceError(404, "Non trovato");
	});

const isV4 =
	typeof (app as unknown as { mount?: unknown }).mount === "function";
if (isV4)
	(app as any).onError((err: unknown, c: Context) => toErrorResponse(err, c));
else
	(app as any).onError((c: Context & { error: unknown }) =>
		toErrorResponse(c.error, c),
	);
app.notFound((c) => c.json(errorBody("NOT_FOUND", "Risorsa non trovata"), 404));
export type AppType = typeof app;
void withErrors;

if (import.meta.main) {
	const out: Record<string, unknown> = {};
	for (const c of cases) {
		const res = await app.request(toRequest(c));
		out[c.name] = { status: res.status, body: await res.text() };
	}
	const echo: Record<string, unknown> = {};
	for (const c of echoCases) {
		const res = await app.request(toRequest(c));
		echo[c.name] = { status: res.status, body: await res.text() };
	}
	const dir = process.env.OUT_DIR;
	const tag = isV4 ? "v4" : "v5";
	await Bun.write(`${dir}/after-${tag}.json`, JSON.stringify(out, null, 2));
	await Bun.write(
		`${dir}/after-echo-${tag}.json`,
		JSON.stringify(echo, null, 2),
	);
	console.log("hono", tag, "done");
}
