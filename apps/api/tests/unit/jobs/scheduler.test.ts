import { describe, expect, it } from "bun:test";
import { Cron } from "croner";
import { startCronJobs, stopCronJobs } from "@/jobs/scheduler";

const romeHour = (date: Date) =>
	new Intl.DateTimeFormat("it-IT", {
		timeZone: "Europe/Rome",
		hour: "numeric",
		hourCycle: "h23",
	}).format(date);

describe("startCronJobs", () => {
	it("ogni job è in ora di Roma, con protect", () => {
		const crons = startCronJobs();
		try {
			const byName = new Map(crons.map((c) => [c.name, c]));
			expect([...byName.keys()].sort()).toEqual([
				"autoCancelSuspendedStores",
				"expirePendingStoreCreations",
				"expireReservations",
				"expireUnpaidOrders",
				"retryStoreTransfers",
			]);
			const next = byName.get("autoCancelSuspendedStores")?.nextRun() as Date;
			expect(romeHour(next)).toBe("3");
			for (const c of crons) {
				expect(c.options.timezone).toBe("Europe/Rome");
				expect(c.options.protect).toBe(true);
			}
		} finally {
			for (const c of crons) c.stop();
		}
	});
});

describe("stopCronJobs", () => {
	it("aspetta il giro in corso", async () => {
		const gate = Promise.withResolvers<void>();
		const cron = new Cron("0 0 1 1 *", { protect: true }, () => gate.promise);
		cron.trigger();
		let done = false;
		const stopping = stopCronJobs([cron], 2_000).then(() => {
			done = true;
		});
		await Bun.sleep(50);
		expect(done).toBe(false);
		gate.resolve();
		await stopping;
		expect(done).toBe(true);
		expect(cron.isStopped()).toBe(true);
	});

	it("non aspetta oltre il tetto", async () => {
		const cron = new Cron(
			"0 0 1 1 *",
			{ protect: true },
			() => new Promise<void>(() => {}),
		);
		cron.trigger();
		const start = performance.now();
		await stopCronJobs([cron], 100);
		expect(performance.now() - start).toBeLessThan(1_000);
		expect(cron.isStopped()).toBe(true);
	});
});
