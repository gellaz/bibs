/**
 * Snapshot of the OpenAPI spec served at GET /openapi/json (the UI is GET /openapi),
 * fetched through app.request without serving (src/app.ts; until U11 the spec came
 * from the OpenAPI plugin of the previous framework). From apps/api:
 *
 *   bun ../../docs/superpowers/plans/2026-10-25-hono-migration/tools/openapi-snapshot.ts \
 *     [--out <file>] [--path /openapi/json]
 *
 * Object keys are sorted recursively (arrays keep their order: it is meaningful),
 * so a rerun diffs cleanly against ../baseline/openapi.json. If the spec route moves
 * during the migration, pass it with --path.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { app, baselineDir, writeJson } from "./load-app";

const { values } = parseArgs({
	options: {
		out: { type: "string", default: join(baselineDir, "openapi.json") },
		path: { type: "string", default: "/openapi/json" },
	},
});

const res = await app.request(`http://localhost${values.path}`);
if (res.status !== 200) throw new Error(`GET ${values.path} → ${res.status}`);

const sortKeys = (v: unknown): unknown =>
	Array.isArray(v)
		? v.map(sortKeys)
		: v && typeof v === "object"
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
				)
			: v;

const spec = (await res.json()) as {
	paths: object;
	components?: { schemas?: object };
};
await writeJson(values.out, sortKeys(spec));
console.error(
	`${Object.keys(spec.paths).length} paths, ` +
		`${Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0)} operations, ` +
		`${Object.keys(spec.components?.schemas ?? {}).length} component schemas`,
);
