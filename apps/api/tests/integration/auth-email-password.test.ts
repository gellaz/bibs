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

mock.module("@/lib/email", () => ({
	sendEmail: async () => {},
}));

import { and, eq } from "drizzle-orm";
import {
	account as accountTable,
	session as sessionTable,
	user as userTable,
} from "@/db/schemas/auth";
import { truncateAll } from "../helpers/cleanup";

/**
 * Contract test between better-auth and the hand-written auth schema.
 *
 * The `user`/`session`/`account` tables are written by better-auth's
 * drizzleAdapter, but `@/db/schemas/auth` is maintained by hand (not generated
 * by the better-auth CLI). Nothing else in the suite runs better-auth itself:
 * `tests/modules/registration.test.ts` mocks the registration services at the
 * route level, so a mismatch between what the adapter expects and what the
 * schema provides is invisible to tsc (the adapter is untyped against our
 * pgTables), invisible to the rest of the suite, and only surfaces at the first
 * real login — which the frontends perform against the NATIVE
 * `/auth/api/sign-in/email` endpoint, bypassing our `/register/*` wrappers.
 *
 * `@/lib/auth` MUST be imported dynamically inside each test. A static import
 * at the top of the file is evaluated before `mock.module("@/db")` takes
 * effect, and `betterAuth({ database: drizzleAdapter(db) })` captures `db`
 * eagerly at module evaluation — so the adapter would bind to the real pool
 * and every query would fail with ECONNREFUSED against localhost:5432.
 */

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("better-auth email/password against the migrated schema", () => {
	it("signUpEmail writes the user and credential account rows", async () => {
		const { auth } = await import("@/lib/auth");
		const db = getTestDb();
		const email = "signup@test.com";

		const result = await auth.api.signUpEmail({
			body: { name: "Sign Up", email, password: "password123" },
		});
		expect(result.user.email).toBe(email);

		const [row] = await db
			.select()
			.from(userTable)
			.where(eq(userTable.email, email));
		expect(row).toBeDefined();
		// sendOnSignUp is false and nothing has verified the address yet.
		expect(row.emailVerified).toBe(false);

		// The credential account holds the password hash; without it sign-in can
		// never succeed, so it is part of the schema contract.
		const [credential] = await db
			.select()
			.from(accountTable)
			.where(
				and(
					eq(accountTable.userId, row.id),
					eq(accountTable.providerId, "credential"),
				),
			);
		expect(credential).toBeDefined();
		expect(credential.password).toBeTruthy();
	});

	it("blocks sign-in until the email is verified, then opens a session", async () => {
		const { auth } = await import("@/lib/auth");
		const db = getTestDb();
		const email = "signin@test.com";
		const password = "password123";

		await auth.api.signUpEmail({
			body: { name: "Sign In", email, password },
		});

		// requireEmailVerification is on, so the native endpoint must refuse.
		await expect(
			auth.api.signInEmail({ body: { email, password } }),
		).rejects.toMatchObject({ status: "FORBIDDEN" });

		await db
			.update(userTable)
			.set({ emailVerified: true })
			.where(eq(userTable.email, email));

		const signedIn = await auth.api.signInEmail({
			body: { email, password },
		});
		expect(signedIn.token).toBeTruthy();

		const sessions = await db
			.select()
			.from(sessionTable)
			.where(eq(sessionTable.userId, signedIn.user.id));
		expect(sessions).toHaveLength(1);
		expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
	});
});
