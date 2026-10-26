/**
 * Hono CLI entry for the whole API: the root Hono app of apps/api/src/app.ts,
 * loaded at runtime by Bun. Run the CLI itself on Bun from apps/api — commands
 * in ../baseline/hono-cli.md.
 *
 * Why an entry and not `hono … src/app.ts`: the CLI bundles its entry with
 * esbuild and imports the bundle from a `data:` URL, where `import … from "bun"`
 * (src/lib/s3.ts) cannot resolve, and it forces `jsxImportSource: "hono/jsx"`
 * on @bibs/emails' react-email templates. Here the app is imported with a
 * computed path, so esbuild leaves it to Bun at runtime.
 *
 * Until U11 this file wrapped the Elysia app: every Elysia route was mirrored
 * on a Hono app forwarding to `app.fetch`, so the CLI could see the table.
 */
import { join } from "node:path";

const { app } = await import(join(process.cwd(), "src/app.ts"));

export default app;
