import { describe, expect, it } from "bun:test";
import { startCronJobs } from "@/jobs/scheduler";

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
