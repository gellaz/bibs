// Read-only probe: does t.File({type:"text/csv"}) accept a real CSV in Elysia 1.4.30?
const { Elysia, t } = await import(
	"/Users/marcogelli/repos/jelaz/bibs/apps/api/node_modules/elysia"
);
const app = new Elysia()
	.onError(({ code, error }) => ({
		code,
		msg: (error as any)?.message?.slice?.(0, 120),
	}))
	.post("/csv", ({ body }) => ({ ok: true, size: body.file.size }), {
		body: t.Object({ file: t.File({ type: "text/csv" }), storeId: t.String() }),
	})
	.post("/any", ({ body }) => ({ ok: true, size: body.file.size }), {
		body: t.Object({ file: t.File() }),
	})
	.post("/img", ({ body }) => ({ ok: true }), {
		body: t.Object({
			file: t.File({ type: "image", maxSize: "5m" }),
			position: t.Optional(t.Integer({ minimum: 0 })),
		}),
	})
	.post("/strip", ({ body }) => body, {
		body: t.Object({ a: t.String(), nested: t.Object({ b: t.String() }) }),
		response: t.Object({ a: t.String(), nested: t.Object({ b: t.String() }) }),
	})
	.get(
		"/resp",
		() => ({ a: "x", secret: "s", nested: { b: "y", hidden: 1 } }),
		{
			response: t.Object({
				a: t.String(),
				nested: t.Object({ b: t.String() }),
			}),
		},
	)
	.get("/q", ({ query }) => query, {
		query: t.Object({
			page: t.Optional(t.Integer({ default: 1 })),
			on: t.Optional(t.Boolean()),
			ids: t.Optional(t.Array(t.String())),
			n: t.Optional(t.Number()),
		}),
	});
const fd = (name: string, blob: Blob, extra: Record<string, string> = {}) => {
	const f = new FormData();
	f.append("file", blob, name);
	for (const [k, v] of Object.entries(extra)) f.append(k, v);
	return f;
};
const show = async (label: string, r: Response) =>
	console.log(label, r.status, await r.text());
await show(
	"csv",
	await app.handle(
		new Request("http://localhost/csv", {
			method: "POST",
			body: fd("p.csv", new Blob(["name,price\nA,1\n"], { type: "text/csv" }), {
				storeId: "s",
			}),
		}),
	),
);
await show(
	"any",
	await app.handle(
		new Request("http://localhost/any", {
			method: "POST",
			body: fd("p.csv", new Blob(["name,price\nA,1\n"], { type: "text/csv" })),
		}),
	),
);
await show(
	"img-fake",
	await app.handle(
		new Request("http://localhost/img", {
			method: "POST",
			body: fd("a.png", new Blob(["not a png"], { type: "image/png" }), {
				position: "2",
			}),
		}),
	),
);
await show(
	"strip-body",
	await app.handle(
		new Request("http://localhost/strip", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ a: "1", extra: 2, nested: { b: "2", deep: 3 } }),
		}),
	),
);
await show(
	"strip-resp",
	await app.handle(new Request("http://localhost/resp")),
);
await show(
	"query",
	await app.handle(new Request("http://localhost/q?on=true&ids=a&ids=b&n=1.5")),
);
await show(
	"query-csv-array",
	await app.handle(new Request("http://localhost/q?ids=a,b")),
);
await show(
	"query-extra",
	await app.handle(new Request("http://localhost/q?zzz=1")),
);
process.exit(0);
