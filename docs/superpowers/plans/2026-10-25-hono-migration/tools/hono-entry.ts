/**
 * Hono CLI entry for the whole API: the real Elysia app (loaded by load-app.ts:
 * no listen, no cron, no S3 call) behind a Hono app. Bun only, so run the CLI
 * itself on Bun from apps/api — commands in ../baseline/hono-cli.md.
 *
 * A bare `new Hono().mount("/", app.fetch)` is one opaque `ALL /*` handler:
 * `hono routes` lists nothing and `hono snapshot` only probes the 404. So every
 * Elysia route is also registered on Hono, forwarding the untouched request to
 * the same app.fetch: the CLI sees the route table, the answers stay Elysia's.
 * The mount stays as the fallback for what no route matches (the 404 body).
 *
 * hono is imported at runtime from apps/api: a static import would make the CLI's
 * esbuild resolve it from docs/, where no node_modules has it. The fallback uses
 * the `hono/mount` middleware (`app.mount()` is gone in Hono 5); registered on
 * `/*` it is the same middleware row `app.mount("/", …)` gave on Hono 4.
 */
import { app } from "./load-app";

const { Hono } = await import(Bun.resolveSync("hono", process.cwd()));
const { mount } = await import(Bun.resolveSync("hono/mount", process.cwd()));

const hono = new Hono();
for (const route of app.routes)
	hono.on(route.method, route.path, (c: { req: { raw: Request } }) =>
		app.fetch(c.req.raw),
	);

export default hono.all("/*", mount(app.fetch, { replaceRequest: false }));
