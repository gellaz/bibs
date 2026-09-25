import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { sql } from "drizzle-orm";

import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { paymentMethod } from "@/db/schemas/payment-method";
import { pointTransaction } from "@/db/schemas/points";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";
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

// Drizzle wraps the underlying pg error in a generic "Failed query: …"
// DrizzleQueryError whose own `.message` never contains the constraint name;
// the driver's original error (with `.constraint`) is its `.cause` (mirrors
// the wrapping documented in tests/plugins/error-handler.test.ts). Awaiting
// via Promise.resolve() also normalizes Drizzle's thenable query builders
// (not real Promises) so rejection can be inspected directly.
async function expectConstraintViolation(
	thenable: PromiseLike<unknown>,
	constraint: string,
) {
	const err = await Promise.resolve(thenable).then(
		() => null,
		(e) => e,
	);
	expect(err).not.toBeNull();
	expect((err as { cause?: { constraint?: string } }).cause?.constraint).toBe(
		constraint,
	);
}

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

	it("seller_profile_changes rifiuta change_type 'payment'", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await expectConstraintViolation(
			db.execute(
				sql`INSERT INTO seller_profile_changes (id, seller_profile_id, change_type, change_data)
				    VALUES (${crypto.randomUUID()}, ${seller.profile.id}, 'payment', '{}'::jsonb)`,
			),
			"seller_profile_change_type_valid",
		);
	});

	it("payment_methods: stripe_account_id unico e flag a false di default", async () => {
		const db = getTestDb();
		const a = await createTestSeller(db);
		const b = await createTestSeller(db);
		const [pm] = await db
			.insert(paymentMethod)
			.values({ sellerProfileId: a.profile.id, stripeAccountId: "acct_DUP" })
			.returning();
		expect(pm.chargesEnabled).toBe(false);
		expect(pm.payoutsEnabled).toBe(false);
		expect(pm.detailsSubmitted).toBe(false);
		await expectConstraintViolation(
			db
				.insert(paymentMethod)
				.values({ sellerProfileId: b.profile.id, stripeAccountId: "acct_DUP" }),
			"payment_method_stripe_account_id_unique",
		);
	});
});
