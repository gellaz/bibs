// D11 probe: me/ with @hono/zod-openapi 1.6.3 on hono 5.0.0-rc.1, doc diffed against the baseline.
import "../tests/preload";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { hc } from "hono/client";

const ErrorSchema = (code: string) =>
	z.object({
		success: z.literal(false),
		error: z.literal(code),
		message: z
			.string()
			.openapi({ description: "Messaggio di errore leggibile" }),
	});
const errors = {
	400: ["BAD_REQUEST"],
	401: ["UNAUTHORIZED"],
	403: ["FORBIDDEN"],
	404: ["NOT_FOUND"],
	422: ["VALIDATION_ERROR"],
	500: ["INTERNAL_ERROR"],
} as const;
const errorResponses = Object.fromEntries(
	Object.entries(errors).map(([status, [code]]) => [
		status,
		{
			description: `Response for status ${status}`,
			content: { "application/json": { schema: ErrorSchema(code) } },
		},
	]),
);

const upload = createRoute({
	method: "post",
	path: "/avatar",
	summary: "Carica immagine profilo",
	description:
		"Carica un'immagine per l'utente corrente. Il file viene ridimensionato a 512x512 JPEG e salvato su S3. La URL viene scritta su `user.image`.",
	tags: ["Me"],
	security: [{ bearerAuth: [] }],
	request: {
		body: {
			required: true,
			content: {
				"multipart/form-data": {
					schema: z.object({
						file: z.any().openapi({
							type: "string",
							format: "binary",
							description: "Immagine (max 5MB, formati image/*)",
						}),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Response for status 200",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							image: z.string().openapi({
								description: "URL pubblica della nuova immagine profilo",
							}),
						}),
					}),
				},
			},
		},
		...errorResponses,
	},
});

const remove = createRoute({
	method: "delete",
	path: "/avatar",
	summary: "Rimuovi immagine profilo",
	description:
		"Setta `user.image` a NULL e cancella il file da S3 (best-effort). No-op se l'utente non ha un'immagine.",
	tags: ["Me"],
	security: [{ bearerAuth: [] }],
	responses: {
		200: {
			description: "Response for status 200",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.null(),
						message: z.string(),
					}),
				},
			},
		},
		...errorResponses,
	},
});

const app = new OpenAPIHono()
	.openapi(upload, (c) =>
		c.json({ success: true as const, data: { image: "x" } }, 200),
	)
	.openapi(remove, (c) =>
		c.json({ success: true as const, data: null, message: "ok" }, 200),
	);

const doc = app.getOpenAPI31Document({
	openapi: "3.1.0",
	info: { title: "x", version: "1" },
});
const mine = (doc.paths as any)["/avatar"];
const baseline = (
	await Bun.file(
		"../../docs/superpowers/plans/2026-10-25-hono-migration/baseline/openapi.json",
	).json()
).paths["/me/avatar"];

// Leaf-level diff, key-order-insensitive.
function leaves(v: unknown, path = ""): Map<string, string> {
	const out = new Map<string, string>();
	if (v && typeof v === "object")
		for (const [k, c] of Object.entries(v))
			for (const [p, l] of leaves(c, `${path}/${k}`)) out.set(p, l);
	else out.set(path, JSON.stringify(v));
	return out;
}
const a = leaves(baseline);
const b = leaves(mine);
const missing = [...a.keys()].filter((k) => !b.has(k));
const extra = [...b.keys()].filter((k) => !a.has(k));
const changed = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k));
console.log(
	JSON.stringify({
		baselineLeaves: a.size,
		missing: missing.length,
		extra: extra.length,
		changed: changed.length,
		sampleMissing: missing.slice(0, 8),
		sampleExtra: extra.slice(0, 8),
		sampleChanged: changed.slice(0, 5),
	}),
);

// hc inference through OpenAPIHono on hono 5
const client = hc<typeof app>("http://localhost");
const r = await client.avatar.$delete();
if (r.ok) {
	const body: { message: string } = await r.json();
	void body;
}
