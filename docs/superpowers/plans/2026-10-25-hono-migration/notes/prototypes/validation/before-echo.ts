// Elysia echo app: real plugins (errorHandler, normalize) + real schemas.
import "../tests/preload";
import { Elysia, t } from "elysia";
import { ServiceError } from "@/lib/errors";
import { PaginationQuery } from "@/lib/pagination";
import { ProductSearchQuery } from "@/lib/queries";
import { DiscountCreateBody, okRes, withErrors } from "@/lib/schemas";
import { errorHandler } from "@/plugins/error-handler";
import { normalize } from "@/plugins/normalize";
import { toRequest } from "./cases";
import { describeValue, echoCases } from "./echo-cases";

const RespSchema = t.Object({
	id: t.String(),
	createdAt: t.Date(),
	note: t.Nullable(t.String()),
	nested: t.Object({ a: t.Integer() }),
	list: t.Array(t.Object({ b: t.String() })),
});

export const app = new Elysia()
	.use(errorHandler)
	.use(normalize)
	.post("/echo/discount", ({ body }) => describeValue(body), {
		body: DiscountCreateBody,
	})
	.get("/echo/products", ({ query }) => describeValue(query), {
		query: ProductSearchQuery,
	})
	.get(
		"/echo/param/:n",
		({ params, query }) => describeValue({ params, query }),
		{
			params: t.Object({ n: t.Integer() }),
			query: PaginationQuery,
		},
	)
	.get(
		"/echo/resp",
		() =>
			({
				success: true,
				data: {
					id: "1",
					createdAt: new Date("2026-01-01T00:00:00Z"),
					note: null,
					passwordHash: "SECRET",
					nested: { a: 1, internal: "x" },
					list: [{ b: "y", internal: "z" }],
				},
				leak: true,
			}) as never,
		{ response: withErrors({ 200: okRes(RespSchema) }) },
	)
	.get(
		"/echo/resp-invalid",
		() => ({ success: true, data: { id: 1 } }) as never,
		{
			response: withErrors({ 200: okRes(RespSchema) }),
		},
	)
	.get(
		"/echo/resp-404",
		() => {
			throw new ServiceError(404, "Non trovato");
		},
		{ response: withErrors({ 200: okRes(RespSchema) }) },
	);

if (import.meta.main) {
	const out: Record<string, unknown> = {};
	for (const c of echoCases) {
		const res = await app.handle(toRequest(c));
		out[c.name] = { status: res.status, body: await res.text() };
	}
	await Bun.write(
		`${process.env.OUT_DIR}/before-echo.json`,
		JSON.stringify(out, null, 2),
	);
	process.exit(0);
}
