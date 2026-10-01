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

const sent: { to: string; subject: string }[] = [];
mock.module("@/lib/email", () => ({
	sendEmail: async ({ to, subject }: { to: string; subject: string }) => {
		sent.push({ to, subject });
	},
}));

import { eq } from "drizzle-orm";
import { user as userTable } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { PendingVerificationError } from "@/lib/errors";
import { truncateAll } from "../helpers/cleanup";

/**
 * Re-signup with an email that is still waiting for verification, against
 * better-auth for real. tests/modules/registration-pending-email.test.ts covers
 * the pure decision (decideExistingUser) and tests/modules/registration.test.ts
 * the 409 shape at the route level with the services mocked; neither shows
 * what the service does to the database and to the outbox.
 *
 * `@/modules/registration/services` is imported dynamically inside each test:
 * it imports `@/lib/auth`, whose drizzleAdapter captures `db` at module
 * evaluation, before `mock.module("@/db")` would take effect for a static
 * import. See auth-email-password.test.ts.
 */

const EMAIL = "pending@test.com";
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	sent.length = 0;
});

async function usersWithEmail() {
	return getTestDb()
		.select({
			id: userTable.id,
			emailVerified: userTable.emailVerified,
		})
		.from(userTable)
		.where(eq(userTable.email, EMAIL));
}

describe("registration with an email pending verification", () => {
	it("re-sends the link and answers 409 PENDING, without a second user", async () => {
		const { registerCustomer } = await import(
			"@/modules/registration/services"
		);
		await registerCustomer({ email: EMAIL, password: "password123" });
		const [first] = await usersWithEmail();
		expect(first.emailVerified).toBe(false);
		expect(sent.map((m) => m.to)).toEqual([EMAIL]);

		const before = Date.now();
		const err = await registerCustomer({
			email: EMAIL,
			password: "another-password",
		}).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(PendingVerificationError);
		const { status, resentAt } = err as PendingVerificationError;
		expect(status).toBe(409);
		expect(Date.parse(resentAt)).toBeGreaterThanOrEqual(before - 1000);

		// A fresh link went out to the same address…
		expect(sent.map((m) => m.to)).toEqual([EMAIL, EMAIL]);
		// …and the original account is untouched: same row, still unverified.
		expect(await usersWithEmail()).toEqual([
			{ id: first.id, emailVerified: false },
		]);
	});

	it("replaces an abandoned signup older than 7 days with a new one", async () => {
		const { registerCustomer } = await import(
			"@/modules/registration/services"
		);
		const db = getTestDb();
		await registerCustomer({ email: EMAIL, password: "password123" });
		const [stale] = await usersWithEmail();
		await db
			.update(userTable)
			.set({ createdAt: new Date(Date.now() - 8 * DAY_MS) })
			.where(eq(userTable.id, stale.id));

		const result = await registerCustomer({
			email: EMAIL,
			password: "password123",
		});

		const users = await usersWithEmail();
		expect(users).toHaveLength(1);
		expect(users[0].id).toBe(result.user.id);
		expect(users[0].id).not.toBe(stale.id);
		// The old profile went with the old user (FK cascade), the new one exists.
		const profiles = await db
			.select({ userId: customerProfile.userId })
			.from(customerProfile);
		expect(profiles).toEqual([{ userId: result.user.id }]);
		expect(sent.map((m) => m.to)).toEqual([EMAIL, EMAIL]);
	});

	it("a verified email is a hard conflict and sends nothing", async () => {
		const { registerCustomer } = await import(
			"@/modules/registration/services"
		);
		await registerCustomer({ email: EMAIL, password: "password123" });
		await getTestDb()
			.update(userTable)
			.set({ emailVerified: true })
			.where(eq(userTable.email, EMAIL));
		sent.length = 0;

		await expect(
			registerCustomer({ email: EMAIL, password: "password123" }),
		).rejects.toMatchObject({ status: 409, code: "EMAIL_ALREADY_REGISTERED" });
		expect(sent).toEqual([]);
		expect(await usersWithEmail()).toHaveLength(1);
	});
});
