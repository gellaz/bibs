// Strangler option: Hono + the CURRENT schemas (Elysia `t`, TypeBox 0.34) + unchanged
// validation-message.ts. Run: OUT_DIR=… bun probe/after-034.ts
import "../tests/preload";
import { type TSchema, Type } from "@sinclair/typebox";
import { TransformDecodeError, Value } from "@sinclair/typebox/value";
import { t } from "elysia";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { ServiceError } from "@/lib/errors";
import { ProductSearchQuery } from "@/lib/queries";
import { DiscountCreateBody, DiscountListQuery } from "@/lib/schemas";
import { validationMessage } from "@/lib/validation-message";
import { cases, toRequest } from "./cases";

class VErr extends Error {
	constructor(
		public type: string,
		public valueError: any,
	) {
		super("validation");
	}
	get customError() {
		return this.valueError?.schema?.error;
	}
}
const coerced = new WeakMap<TSchema, TSchema>();
const coerce = (s: any): TSchema => {
	if (!coerced.has(s))
		coerced.set(
			s,
			Type.Object(
				Object.fromEntries(
					Object.entries(s.properties).map(([k, p]: [string, any]) => {
						const { type: _, ...o } = p;
						const c =
							p.type === "number"
								? t.Numeric(o)
								: p.type === "boolean"
									? t.BooleanString(o)
									: p;
						return [
							k,
							c !== p && !s.required?.includes(k) ? Type.Optional(c) : c,
						];
					}),
				),
			),
		);
	return coerced.get(s) as TSchema;
};
const trim = (x: any): any =>
	typeof x === "string"
		? x.trim()
		: Array.isArray(x)
			? x.map(trim)
			: x && typeof x === "object"
				? Object.fromEntries(
						Object.entries(x).map(([k, v]) => [
							k,
							/password/i.test(k) ? v : trim(v),
						]),
					)
				: x;
const v = (target: "json" | "query", schema: TSchema) =>
	validator(target, (raw, c) => {
		const s = target === "query" ? coerce(schema) : schema;
		let value: any =
			target === "json" && !c.req.header("content-type") ? undefined : raw;
		if (target === "query")
			value = Object.fromEntries(
				Object.entries(value).map(([k, x]) => [
					k,
					Array.isArray(x) ? x.at(-1) : x,
				]),
			);
		value = Value.Clean(s, Value.Default(s, Value.Clone(value)));
		if (target === "json") value = trim(value);
		if (!Value.Check(s, value))
			throw new VErr(
				target === "json" ? "body" : target,
				Value.Errors(s, value).First(),
			);
		try {
			return Value.Decode(s, value);
		} catch (e) {
			// Elysia's t.Integer / t.Numeric decoders throw a ValueError-bearing error; path is lost.
			const inner = e instanceof TransformDecodeError ? e.error : e;
			const ve = (inner as any)?.error ?? (inner as any)?.valueError ?? inner;
			throw new VErr("property", { ...ve, path: "" });
		}
	});
const body = (error: string, message: string) => ({
	success: false,
	error,
	message,
});
const auth = async () => {
	throw new ServiceError(401, "Devi accedere per continuare");
};
const app = new Hono()
	.post(
		"/register/customer",
		v(
			"json",
			t.Object({
				email: t.String({ format: "email" }),
				password: t.String({ minLength: 8, maxLength: 128 }),
			}),
		),
		(c) => c.json(null),
	)
	.post("/seller/discounts", v("json", DiscountCreateBody), auth, (c) =>
		c.json(null),
	)
	.get("/seller/discounts", v("query", DiscountListQuery), auth, (c) =>
		c.json(null),
	)
	.get("/customer/products", v("query", ProductSearchQuery), (c) =>
		c.json(null),
	);
const onErr = (err: unknown, c: Context) =>
	err instanceof ServiceError
		? c.json(body(err.code, err.message), err.status as 401)
		: err instanceof VErr
			? c.json(body("VALIDATION_ERROR", validationMessage(err as any)), 422)
			: c.json(body("INTERNAL_ERROR", "Errore interno del server"), 500);
if (typeof (app as any).mount === "function") (app as any).onError(onErr);
else (app as any).onError((c: any) => onErr(c.error, c));
app.notFound((c) => c.json(body("NOT_FOUND", "Risorsa non trovata"), 404));
void HTTPException;

const out: Record<string, unknown> = {};
for (const c of cases) {
	const res = await app.request(toRequest(c));
	out[c.name] = { status: res.status, body: await res.text() };
}
await Bun.write(
	`${process.env.OUT_DIR}/after-034.json`,
	JSON.stringify(out, null, 2),
);
console.log("done");
