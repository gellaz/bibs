import { describe, expect, it, mock } from "bun:test";

// Il DB non risponde: prendere il lock fallisce prima di entrare nel job.
mock.module("@/db", () => ({
	db: { $client: { connect: () => Promise.reject(new Error("DB giù")) } },
}));

const { startCronJobs } = await import("@/jobs/scheduler");

describe("startCronJobs con il DB giù", () => {
	it("un giro che non prende il lock non lancia", async () => {
		const crons = startCronJobs();
		try {
			const cron = crons.find((c) => c.name === "expireReservations");
			await expect(cron?.trigger()).resolves.toBeUndefined();
		} finally {
			for (const c of crons) c.stop();
		}
	});
});
