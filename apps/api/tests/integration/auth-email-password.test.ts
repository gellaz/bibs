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

const sentEmails: { to: string; subject: string; html: string }[] = [];

mock.module("@/lib/email", () => ({
	sendEmail: async (email: { to: string; subject: string; html: string }) => {
		sentEmails.push(email);
	},
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
	sentEmails.length = 0;
});

/** better-auth può inviare in background: aspetta l'email per `to`. */
async function waitForEmail(to: string) {
	for (let i = 0; i < 50; i++) {
		const found = sentEmails.find((e) => e.to === to);
		if (found) return found.html.replaceAll("<!-- -->", "");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`nessuna email inviata a ${to}`);
}

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

	it("greets neutrally, never with the email local-part, until firstName is set", async () => {
		const { auth } = await import("@/lib/auth");
		const db = getTestDb();
		const email = "mario.rossi@test.com";

		// Come `registerUser`: alla registrazione `name` è la parte locale.
		await auth.api.signUpEmail({
			body: { name: "mario.rossi", email, password: "password123" },
		});
		await auth.api.sendVerificationEmail({
			body: { email, callbackURL: "http://localhost:3001" },
		});
		const verification = await waitForEmail(email);
		expect(verification).toContain("Ciao,");
		expect(verification).not.toContain("mario.rossi");

		// Col nome nel profilo il saluto lo usa (additionalFields a runtime).
		await db
			.update(userTable)
			.set({ emailVerified: true, firstName: "Mario" })
			.where(eq(userTable.email, email));
		sentEmails.length = 0;
		await auth.api.requestPasswordReset({
			body: { email, redirectTo: "http://localhost:3001/reset-password" },
		});
		expect(await waitForEmail(email)).toContain("Ciao Mario,");
	});
});
