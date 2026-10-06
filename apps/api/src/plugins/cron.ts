import { cron, Patterns } from "@elysiajs/cron";
import { Elysia } from "elysia";
import { runAutoCancelSuspended } from "@/jobs/auto-cancel-suspended-stores";
import { runExpirePending } from "@/jobs/expire-pending-store-creations";
import { expireReservations } from "@/lib/jobs/expire-reservations";
import { expireUnpaidOrders } from "@/lib/jobs/expire-unpaid-orders";
import { retryStoreTransfers } from "@/lib/jobs/retry-store-transfers";
import { logger } from "@/lib/logger";

export const cronJobs = new Elysia({ name: "cron-jobs" })
	.use(
		cron({
			name: "expireReservations",
			pattern: Patterns.EVERY_MINUTE,
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
		}),
	)
	.use(
		cron({
			name: "expireUnpaidOrders",
			pattern: Patterns.EVERY_MINUTE,
			async run() {
				try {
					const count = await expireUnpaidOrders();
					if (count > 0)
						logger.info(
							{ count },
							"Ordini pay_* non pagati annullati via cron",
						);
				} catch (error) {
					logger.error({ err: error }, "Errore durante scadenza pagamenti");
				}
			},
		}),
	)
	.use(
		cron({
			name: "retryStoreTransfers",
			// Hourly, at :30 so it doesn't overlap the other hourly job
			pattern: "30 * * * *",
			async run() {
				try {
					const count = await retryStoreTransfers();
					if (count > 0)
						logger.info(
							{ count },
							"Trasferimenti ai negozi completati via cron",
						);
				} catch (error) {
					logger.error(
						{ err: error },
						"Errore durante il ritentativo dei trasferimenti ai negozi",
					);
				}
			},
		}),
	)
	.use(
		cron({
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
		}),
	)
	.use(
		cron({
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
		}),
	);
