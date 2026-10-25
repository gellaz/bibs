/**
 * Route inventory of the composed API, without serving it. From apps/api:
 *
 *   bun ../../docs/superpowers/plans/2026-10-25-hono-migration/tools/route-inventory.ts \
 *     [--hono <prefix>=<module>[#export]]... [--out <file>]
 *
 * Writes a JSON array of { method, path, mount?, source? } sorted by path, then method
 * (default: ../baseline/routes.json). Parity check on a PR: rerun with --out to a scratch
 * file and diff it against the committed baseline.
 *
 * Rows:
 * - every Elysia route in app.routes, CORS preflight included (OPTIONS / and /*);
 * - wildcard mounts (`.mount()` registers `ALL <p>` and `ALL <p>/*`) carry `mount`:
 *   "better-auth" when the handler is auth.handler, "hono" for a prefix passed with
 *   --hono, "fetch" for any other mounted handler;
 * - better-auth: the root mount (/auth) is expanded into what its router serves:
 *   auth.api minus SERVER_ONLY endpoints, the rule of better-call's createRouter,
 *   under basePath /api, with `source: "better-auth"`. The copies under module
 *   prefixes (/me/auth/*, /seller/auth/*, ...) appear because modules reuse the named
 *   plugin; their handler slices the unprefixed length and answers 404, so they
 *   stay unexpanded.
 *
 * Hono sub-apps (strangler `elysia.mount('/me', meApp.fetch)`): a mounted fetch is
 * opaque, so pass the app itself, e.g. `--hono /me=src/modules/me/hono.ts#meApp`
 * (default export when #export is omitted; prefix "/" when the sub-app has its own
 * basePath and is mounted at the root). Its routes come from inspectRoutes
 * (hono/dev), middleware skipped, and are listed under the prefix like any other
 * route, so a module moved from Elysia to Hono diffs only by its new mount rows.
 * At the cutover (src/index.ts serving Hono) load-app.ts must capture the Hono app.
 */
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { apiDir, app, baselineDir, writeJson } from "./load-app";

type Row = { method: string; path: string; mount?: string; source?: string };

const { values } = parseArgs({
	options: {
		hono: { type: "string", multiple: true, default: [] },
		out: { type: "string", default: join(baselineDir, "routes.json") },
	},
});

const { auth } = await import(join(apiDir, "src/lib/auth.ts"));
const honoPrefixes = new Set<string>();
const rows: Row[] = [];

for (const spec of values.hono) {
	const match = /^(\/[^=]*)=([^#]+)(?:#(.+))?$/.exec(spec);
	if (!match)
		throw new Error(`--hono ${spec}: expected <prefix>=<module>[#export]`);
	const [, prefix, file, name = "default"] = match;
	const mod = await import(isAbsolute(file) ? file : join(apiDir, file));
	const { inspectRoutes } = await import(Bun.resolveSync("hono/dev", apiDir));
	const base = prefix === "/" ? "" : prefix.replace(/\/$/, "");
	honoPrefixes.add(base || "/");
	for (const r of inspectRoutes(mod[name])) {
		if (r.isMiddleware) continue;
		rows.push({
			method: r.method,
			path: base + (r.path === "/" && base ? "" : r.path),
		});
	}
}

for (const r of app.routes) {
	const handler = r.hooks?.config?.mount;
	if (!handler) {
		rows.push({ method: r.method, path: r.path });
		continue;
	}
	const prefix = r.path.replace(/\/\*$/, "") || "/";
	const mount =
		handler === auth.handler
			? "better-auth"
			: honoPrefixes.has(prefix)
				? "hono"
				: "fetch";
	rows.push({ method: r.method, path: r.path, mount });
	if (mount === "better-auth" && r.path === "/auth/*") {
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
	}
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
