import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { pointTransaction } from "@/db/schemas/points";
import { truncateAll } from "../helpers/cleanup";
import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function seedCustomer(): Promise<string> {
	const db = getTestDb();
	const [u] = await db
		.insert(user)
		.values({ id: "u_check", name: "Check", email: "check@dev.bibs" })
		.returning();
	const [cp] = await db
		.insert(customerProfile)
		.values({ userId: u.id })
		.returning();
	return cp.id;
}

// Guards that the enum CHECK constraints are enforced at the DB level. With the
// migrate-based harness this also confirms the production DDL path (the actual
// migration files) is what the suite runs against.
describe("enum CHECK constraints", () => {
	it("accepts a value inside the enum domain", async () => {
		const customerProfileId = await seedCustomer();
		await getTestDb()
			.insert(pointTransaction)
			.values({ customerProfileId, amount: 10, type: "earned" });
		// no throw = pass
	});

	it("rejects a value outside the enum domain at the DB level", async () => {
		const customerProfileId = await seedCustomer();
		// Deliberately bypass the TS enum to prove the DB-level CHECK rejects
		// out-of-domain values.
		const bogusType = "bogus" as unknown as "earned";
		// Wrap in an async fn so a real Promise (not the Drizzle query builder
		// thenable) reaches expect().rejects.
		const insertBogus = async () =>
			getTestDb()
				.insert(pointTransaction)
				.values({ customerProfileId, amount: 10, type: bogusType });
		await expect(insertBogus()).rejects.toThrow();
	});
});
