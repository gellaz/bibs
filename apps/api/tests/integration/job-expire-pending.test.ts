import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

import { eq } from "drizzle-orm";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { runExpirePending } from "@/jobs/expire-pending-store-creations";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("runExpirePending", () => {
	it("marks open pending rows past expires_at as expired", async () => {
		const { profile: a } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		const { profile: b } = await createTestSeller(getTestDb(), {
			email: "b@c.it",
		});

		const [stale] = await getTestDb()
			.insert(pendingStoreCreation)
			.values({
				sellerProfileId: a.id,
				formData: {},
				feeAmountCents: 2900,
				currency: "EUR",
				status: "open",
				expiresAt: new Date(Date.now() - 86400000),
			})
			.returning();

		await getTestDb()
			.insert(pendingStoreCreation)
			.values({
				sellerProfileId: b.id,
				formData: {},
				feeAmountCents: 2900,
				currency: "EUR",
				status: "open",
				expiresAt: new Date(Date.now() + 86400000),
			})
			.returning();

		const result = await runExpirePending();

		expect(result.expired).toBe(1);
		const updated = await getTestDb()
			.select()
			.from(pendingStoreCreation)
			.where(eq(pendingStoreCreation.id, stale.id))
			.then((r) => r[0]);
		expect(updated.status).toBe("expired");
	});
});
