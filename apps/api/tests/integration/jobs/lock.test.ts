import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

import { runExclusive } from "@/jobs/lock";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

// Il lock è un advisory lock di sessione: due chiamate concorrenti usano due
// connessioni del pool, come due repliche dell'API.
describe("runExclusive", () => {
	it("un secondo runExclusive con la stessa chiave salta mentre il primo gira", async () => {
		const gate = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const first = runExclusive(9999, async () => {
			started.resolve();
			await gate.promise;
		});
		await started.promise;
		let secondRan = false;
		expect(
			await runExclusive(9999, async () => {
				secondRan = true;
			}),
		).toBe(false);
		expect(secondRan).toBe(false);
		gate.resolve();
		expect(await first).toBe(true);
	});

	it("a job finito il lock è libero", async () => {
		expect(await runExclusive(9999, async () => {})).toBe(true);
	});

	it("un job che lancia libera il lock", async () => {
		await expect(
			runExclusive(9999, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await runExclusive(9999, async () => {})).toBe(true);
	});

	it("chiavi diverse non si bloccano", async () => {
		const gate = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const first = runExclusive(9998, async () => {
			started.resolve();
			await gate.promise;
		});
		await started.promise;
		expect(await runExclusive(9997, async () => {})).toBe(true);
		gate.resolve();
		await first;
	});
});
