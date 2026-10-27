import { app } from "@/app";
import { db } from "@/db";
import { startCronJobs } from "@/jobs/scheduler";
import { env } from "@/lib/env";
import { ensureBucket } from "@/lib/s3";

// The server entry: the only module with side effects (S3, listen, cron,
// signals). The app itself lives in `src/app.ts`.

// ── Startup sequence ────────────────────────────────
// Cron first, as before (they were scheduled when the app was built, before
// the bucket check and listen): a slow S3 at boot does not delay them.
startCronJobs();
await ensureBucket();

// Same Bun.serve options the API had before Hono. Bun passes the server as
// the second fetch argument: Hono's `c.env`, read for the socket IP.
const server = Bun.serve({
	port: parseInt(env.PORT, 10),
	development: env.NODE_ENV !== "production",
	reusePort: true,
	idleTimeout: 30,
	fetch: app.fetch,
});
console.log(`bibs API in ascolto su ${server.url}`);

// ── Graceful shutdown ───────────────────────────────
const shutdown = async () => {
	console.log("\n🛑 Shutting down...");
	server.stop();
	await db.$client.end();
	process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
