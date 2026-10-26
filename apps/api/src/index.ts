import { app } from "@/app";
import { db } from "@/db";
import { env } from "@/infra/env";
import { ensureBucket } from "@/infra/s3";
import { startCronJobs, stopCronJobs } from "@/jobs/scheduler";

// The server entry: the only module with side effects (S3, listen, cron,
// signals). The app itself lives in `src/app.ts`.

// ── Startup sequence ────────────────────────────────
// Cron first, as before (they were scheduled when the app was built, before
// the bucket check and listen): a slow S3 at boot does not delay them.
const crons = startCronJobs();
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
// Under the 10 s `docker stop` grants before SIGKILL.
const SHUTDOWN_TIMEOUT_MS = 8_000;
let shuttingDown = false;
const shutdown = async () => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log("\n🛑 Shutting down...");
	// No new requests or ticks; the ones in flight finish before the pool
	// closes, within the cap.
	await Promise.race([
		Promise.all([server.stop(), stopCronJobs(crons, SHUTDOWN_TIMEOUT_MS)]),
		Bun.sleep(SHUTDOWN_TIMEOUT_MS),
	]);
	await db.$client.end();
	process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
