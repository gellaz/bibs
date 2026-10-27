import { describe, expect, it } from "bun:test";
import { Cron } from "croner";
import { gracefulShutdown } from "@/shutdown";

const never = () => new Promise<void>(() => {});

describe("gracefulShutdown", () => {
	it("un job in corso finisce prima che il pool si chiuda", async () => {
		const events: string[] = [];
		const gate = Promise.withResolvers<void>();
		const cron = new Cron("0 0 1 1 *", { protect: true }, async () => {
			await gate.promise;
			events.push("job finito");
		});
		cron.trigger();
		const done = gracefulShutdown({
			server: { stop: async () => {} },
			crons: [cron],
			pool: {
				end: async () => {
					events.push("pool chiuso");
				},
			},
		});
		await Bun.sleep(50);
		expect(events).toEqual([]);
		gate.resolve();
		await done;
		expect(events).toEqual(["job finito", "pool chiuso"]);
	});

	it("rispetta il tetto anche con richieste, job e pool bloccati", async () => {
		const cron = new Cron("0 0 1 1 *", { protect: true }, never);
		cron.trigger();
		const start = performance.now();
		await gracefulShutdown(
			{ server: { stop: never }, crons: [cron], pool: { end: never } },
			{ waitMs: 50, poolMs: 50 },
		);
		expect(performance.now() - start).toBeLessThan(1_000);
	});
});
