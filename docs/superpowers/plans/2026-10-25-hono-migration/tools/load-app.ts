/**
 * Loads the API's root Hono app (apps/api/src/app.ts) without serving it.
 * Run the tools from apps/api (cwd = apps/api): Bun loads its .env/.env.local
 * and resolves "hono" to the same module instance src/app.ts uses.
 *
 * Since U11 the app has no import side effects: the server, the cron jobs and
 * ensureBucket() live in src/index.ts, which the tools never load. Importing
 * the app still runs `assertRoutes` on every module (D9) and opens no
 * connection (the pg pool is lazy). Until U11 this file captured the
 * composed app of src/index.ts by stubbing its listen, cron and S3 call.
 */
import { basename, join } from "node:path";

const apiDir = process.cwd();
if (!(await Bun.file(join(apiDir, "src/app.ts")).exists()))
	throw new Error("Run this tool from apps/api (cwd must be apps/api)");

const { app } = await import(join(apiDir, "src/app.ts"));

// any: the tools read Hono internals (routes, handlers)
export { apiDir, app };

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
