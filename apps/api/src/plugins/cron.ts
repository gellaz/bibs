import { cron, Patterns } from "@elysiajs/cron";
import { Elysia } from "elysia";
import { expireReservations } from "@/lib/jobs/expire-reservations";
import { logger } from "@/lib/logger";

export const cronJobs = new Elysia({ name: "cron-jobs" }).use(
	cron({
		name: "expireReservations",
		pattern: Patterns.everyMinutes(10),
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
);
