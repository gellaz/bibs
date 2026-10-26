import type { Cron } from "croner";
import { logger } from "@/infra/logger";
import { stopCronJobs } from "@/jobs/scheduler";

/**
 * SIGTERM/SIGINT: no new requests or ticks; the ones in flight finish before
 * the pool closes, within `waitMs`. `pool.end()` waits for checked-out clients
 * too, so it gets its own cap: a stuck query must not outlive `docker stop`'s
 * 10 s (8 + 1 s by default).
 */
export async function gracefulShutdown(
	parts: {
		server: { stop(): Promise<void> | void };
		crons: Cron[];
		pool: { end(): Promise<void> };
	},
	{ waitMs = 8_000, poolMs = 1_000 }: { waitMs?: number; poolMs?: number } = {},
): Promise<void> {
	logger.info("Shutdown");
	await Promise.race([
		Promise.all([parts.server.stop(), stopCronJobs(parts.crons, waitMs)]),
		Bun.sleep(waitMs),
	]);
	await Promise.race([parts.pool.end(), Bun.sleep(poolMs)]);
}
