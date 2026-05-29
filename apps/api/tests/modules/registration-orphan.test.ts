import { describe, expect, it, mock } from "bun:test";
import type { Logger } from "pino";
import { provisionOrRollback } from "@/modules/registration/services";

// signUpEmail commits the user+account row before the role/profile transaction
// runs. provisionOrRollback guarantees that a failed transaction rolls that user
// back (so the email isn't blocked for up to 7 days) and rethrows the cause.
describe("provisionOrRollback", () => {
	it("returns the work result and never rolls back on success", async () => {
		const rollback = mock(async () => undefined);

		const result = await provisionOrRollback(
			"u1",
			async () => "profile",
			rollback,
		);

		expect(result).toBe("profile");
		expect(rollback).toHaveBeenCalledTimes(0);
	});

	it("rolls back the just-created user and rethrows when the work throws", async () => {
		const rollback = mock(async () => undefined);

		await expect(
			provisionOrRollback(
				"u-orphan",
				async () => {
					throw new Error("profile insert failed");
				},
				rollback,
			),
		).rejects.toThrow("profile insert failed");

		expect(rollback).toHaveBeenCalledTimes(1);
		expect(rollback).toHaveBeenCalledWith("u-orphan");
	});

	it("rethrows the original error even if the rollback itself fails", async () => {
		const rollback = mock(async () => {
			throw new Error("delete failed");
		});
		const logger = { error: () => {} } as unknown as Logger;

		await expect(
			provisionOrRollback(
				"u1",
				async () => {
					throw new Error("original cause");
				},
				rollback,
				logger,
			),
		).rejects.toThrow("original cause");
	});
});
