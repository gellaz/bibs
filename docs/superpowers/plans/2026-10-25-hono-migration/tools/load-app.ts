/**
 * Loads the real API app from apps/api/src/index.ts without serving it.
 * Run the tools from apps/api (cwd = apps/api): Bun loads its .env/.env.local
 * and resolves "elysia" to the same module instance src/index.ts uses.
 *
 * - The Bun adapter's listen is replaced by a stub that captures the root app
 *   (index.ts calls app.listen() once, on the fully composed app).
 * - The cron plugin is swapped for an empty one: a tick would write to the dev DB.
 * - ensureBucket() becomes a no-op: no S3 call, the tools work with infra down.
 *   No other module touches the network at import time (the pg pool is lazy).
 */
import { basename, join } from "node:path";

const apiDir = process.cwd();
if (!(await Bun.file(join(apiDir, "src/index.ts")).exists()))
	throw new Error("Run this tool from apps/api (cwd must be apps/api)");

Bun.plugin({
	name: "baseline-no-side-effects",
	setup(build) {
		build.onLoad({ filter: /\/src\/plugins\/cron\.ts$/ }, () => ({
			contents: `import { Elysia } from "elysia";
export const cronJobs = new Elysia({ name: "cron-jobs" });`,
			loader: "ts",
		}));
		build.onLoad({ filter: /\/src\/lib\/s3\.ts$/ }, async ({ path }) => {
			const src = await Bun.file(path).text();
			const signature = "export async function ensureBucket()";
			if (!src.includes(signature))
				throw new Error(`${signature} not found: update load-app.ts`);
			return {
				contents: src.replace(
					signature,
					`${signature} {}\nasync function _realEnsureBucket()`,
				),
				loader: "ts",
			};
		});
	},
});

const { Elysia } = await import(Bun.resolveSync("elysia", apiDir));
let captured: unknown;
// listen is an instance field, not a prototype method: stub the shared adapter it delegates to.
new Elysia()["~adapter"].listen = (root: unknown) => () => {
	captured = root;
};
await import(join(apiDir, "src/index.ts"));
if (!(captured instanceof Elysia))
	throw new Error("src/index.ts did not call app.listen() on an Elysia app");

// any: the tools read Elysia internals (routes, hooks, handle)
export const app = captured as any;
export { apiDir };

export const baselineDir = join(import.meta.dir, "../baseline");

/**
 * Writes JSON formatted by Biome, as the pre-commit hook leaves it, so a rerun
 * diffs cleanly against the committed file. Formatting goes through stdin: it
 * works for --out paths outside the repo and ignores files.maxSize (openapi.json
 * is 2 MiB, so the hook itself skips it).
 */
export async function writeJson(file: string, data: unknown) {
	const biome = Bun.spawnSync(
		["bunx", "biome", "format", `--stdin-file-path=${basename(file)}`],
		{
			cwd: join(apiDir, "../.."),
			stdin: Buffer.from(JSON.stringify(data, null, "\t")),
		},
	);
	if (biome.exitCode !== 0) throw new Error(biome.stderr.toString());
	await Bun.write(file, biome.stdout);
	console.error(`wrote ${file}`);
}
