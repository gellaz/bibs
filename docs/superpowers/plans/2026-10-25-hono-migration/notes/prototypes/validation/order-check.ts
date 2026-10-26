// First-error order: TypeBox 0.34 (what Elysia reports) vs TypeBox 1.
import { Type as T0 } from "@sinclair/typebox";
import { Value as V0 } from "@sinclair/typebox/value";
import Type from "typebox";
import { Value } from "typebox/value";

const mk = (T: any) =>
	T.Object({
		email: T.String({ minLength: 3 }),
		password: T.String({ minLength: 8 }),
		addr: T.Object({ zip: T.String({ minLength: 5 }), city: T.String() }),
		items: T.Array(T.Object({ q: T.Integer({ minimum: 1 }) })),
	});
const S0 = mk(T0);
const S1 = mk(Type);
for (const v of [
	{ email: "x" },
	{ email: "x", password: "1" },
	{ email: "abcd", password: "12345678", addr: { zip: "1" } },
	{
		email: "abcd",
		password: "12345678",
		addr: { zip: "12345", city: "B" },
		items: [{ q: 1 }, { q: 0 }, {}],
	},
]) {
	const e0 = [...V0.Errors(S0, v)].map((e) => `${e.path}:${e.type}`);
	const e1 = [...Value.Errors(S1, v)].map(
		(e: any) =>
			`${e.instancePath}:${e.keyword}${e.keyword === "required" ? `(${e.params.requiredProperties})` : ""}`,
	);
	console.log(
		JSON.stringify(v),
		"\n  0.34:",
		e0.join(" "),
		"\n  1.x :",
		e1.join(" "),
	);
}
