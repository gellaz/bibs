/**
 * Route inventory of the API's root Hono app (src/app.ts), without serving it.
 * From apps/api:
 *
 *   bun ../../docs/superpowers/plans/2026-10-25-hono-migration/tools/route-inventory.ts \
 *     [--out <file>]
 *
 * Writes a JSON array of { method, path, mount?, source? } sorted by path, then method
 * (default: ../baseline/routes.json). Parity check on a PR: rerun with --out to a scratch
 * file and diff it against the committed baseline.
 *
 * Rows:
 * - every route of app.routes with its final handler (middleware rows skipped:
 *   the global `use()`, `doc()`, `v()`, guards; `@ERROR`/`@NOT_FOUND` too);
 * - the better-auth mount (`ALL /auth/*`, which also answers `/auth`) carries
 *   `mount: "better-auth"` and is expanded into what its router serves:
 *   auth.api minus SERVER_ONLY endpoints, the rule of better-call's createRouter,
 *   under basePath /api, with `source: "better-auth"`.
 *
 * Until U11 the root was the Elysia app: its routes came from Elysia's table,
 * Hono sub-apps were passed with `--hono <prefix>=<module>[#export]` and listed
 * through `inspectRoutes`, mounts were `ALL <p>` + `ALL <p>/*` rows, and the CORS
 * preflight had its `OPTIONS /` and `OPTIONS /*` routes.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { apiDir, app, baselineDir, writeJson } from "./load-app";

type Row = { method: string; path: string; mount?: string; source?: string };

const { values } = parseArgs({
	options: {
		out: { type: "string", default: join(baselineDir, "routes.json") },
	},
});

const { auth } = await import(join(apiDir, "src/lib/auth.ts"));
const { authHandler } = await import(
	join(apiDir, "src/plugins/better-auth.ts")
);
const rows: Row[] = [];

// A Hono middleware takes (c, next); a final handler takes (c).
const isMiddleware = (handler: (...args: unknown[]) => unknown) =>
	handler.length > 1;

for (const r of app.routes as {
	method: string;
	path: string;
	handler: (...args: unknown[]) => unknown;
}[]) {
	if (r.method.startsWith("@")) continue;
	if (r.handler === authHandler) {
		rows.push({ method: r.method, path: r.path, mount: "better-auth" });
		for (const endpoint of Object.values(auth.api) as any[]) {
			if (!endpoint?.path || !endpoint.options) continue;
			if (endpoint.options.metadata?.SERVER_ONLY) continue;
			const methods = [endpoint.options.method].flat();
			for (const method of methods)
				rows.push({
					method,
					path: `/auth${auth.options.basePath}${endpoint.path}`,
					source: "better-auth",
				});
		}
		continue;
	}
	if (isMiddleware(r.handler)) continue;
	rows.push({ method: r.method, path: r.path });
}

const key = (r: Row) => `${r.path} ${r.method}`;
rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
const dupes = rows.filter((r, i) => i > 0 && key(r) === key(rows[i - 1]));
if (dupes.length)
	throw new Error(`duplicate routes: ${dupes.map(key).join(", ")}`);

await writeJson(values.out, rows);
console.error(
	`${rows.length} rows: ${rows.filter((r) => !r.mount && !r.source).length} app routes, ` +
		`${rows.filter((r) => r.source === "better-auth").length} better-auth, ` +
		`${rows.filter((r) => r.mount).length} mount rows`,
);
