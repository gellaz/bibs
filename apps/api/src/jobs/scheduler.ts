import { Cron } from "croner";
import { logger } from "@/infra/logger";
import { runAutoCancelSuspended } from "@/jobs/auto-cancel-suspended-stores";
import { runExpirePending } from "@/jobs/expire-pending-store-creations";
import { expireReservations } from "@/jobs/expire-reservations";
import { expireUnpaidOrders } from "@/jobs/expire-unpaid-orders";
import { retryStoreTransfers } from "@/jobs/retry-store-transfers";

interface Job {
	name: string;
	/** Cron pattern, server local time (no timezone option, as before). */
	pattern: string;
	run: () => Promise<void>;
}

const jobs: Job[] = [
	{
		name: "expireReservations",
		pattern: "*/1 * * * *",
		async run() {
			try {
				const count = await expireReservations();
				if (count > 0) {
					logger.info(
						{ count },
						"Prenotazioni reserve_pickup scadute via cron",
					);
				}
			} catch (error) {
				logger.error({ err: error }, "Errore durante scadenza prenotazioni");
			}
		},
	},
	{
		name: "expireUnpaidOrders",
		pattern: "*/1 * * * *",
		async run() {
			try {
				const count = await expireUnpaidOrders();
				if (count > 0)
					logger.info({ count }, "Ordini pay_* non pagati annullati via cron");
			} catch (error) {
				logger.error({ err: error }, "Errore durante scadenza pagamenti");
			}
		},
	},
	{
		name: "retryStoreTransfers",
		// Hourly, at :30 so it doesn't overlap the other hourly job
		pattern: "30 * * * *",
		async run() {
			try {
				const count = await retryStoreTransfers();
				if (count > 0)
					logger.info({ count }, "Trasferimenti ai negozi completati via cron");
			} catch (error) {
				logger.error(
					{ err: error },
					"Errore durante il ritentativo dei trasferimenti ai negozi",
				);
			}
		},
	},
	{
		name: "autoCancelSuspendedStores",
		// Daily at 03:00 server time
		pattern: "0 3 * * *",
		async run() {
			try {
				const result = await runAutoCancelSuspended();
				if (result.canceled > 0) {
					logger.info(
						{ canceled: result.canceled },
						"Auto-cancellate subscription sospese oltre soglia",
					);
				}
			} catch (error) {
				logger.error(
					{ err: error },
					"Errore durante auto-cancel subscription sospese",
				);
			}
		},
	},
	{
		name: "expirePendingStoreCreations",
		// Hourly
		pattern: "0 * * * *",
		async run() {
			try {
				const result = await runExpirePending();
				if (result.expired > 0) {
					logger.info(
						{ expired: result.expired },
						"Pending store creations scaduti via cron",
					);
				}
			} catch (error) {
				logger.error(
					{ err: error },
					"Errore durante expire pending store creations",
				);
			}
		},
	},
];

/**
 * Starts the five jobs: only the server entry (`src/index.ts`) calls it, so
 * tests, tools and the Hono CLI never schedule a tick. Same `croner` call as
 * before: no options (local time, no overrun protection).
 */
export function startCronJobs(): Cron[] {
	const started = jobs.map((job) => new Cron(job.pattern, {}, job.run));
	logger.info({ jobs: jobs.map((job) => job.name) }, "Cron avviati");
	return started;
}
