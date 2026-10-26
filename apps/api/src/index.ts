import { app } from "@/app";
import { db } from "@/db";
import { env } from "@/infra/env";
import { logger } from "@/infra/logger";
import { ensureBucket } from "@/infra/s3";
import { startCronJobs } from "@/jobs/scheduler";
import { gracefulShutdown } from "@/shutdown";

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
logger.info(`bibs API in ascolto su ${server.url}`);

// ── Graceful shutdown ───────────────────────────────
let shuttingDown = false;
const shutdown = async () => {
	if (shuttingDown) return;
	shuttingDown = true;
	await gracefulShutdown({ server, crons, pool: db.$client });
	process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
