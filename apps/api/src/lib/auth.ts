import { renderVerificationEmail } from "@bibs/emails";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, openAPI } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user as userTable } from "@/db/schemas/auth";
import { sellerProfile } from "@/db/schemas/seller";
import { sendEmail } from "@/lib/email";
import {
	ac,
	adminRole,
	customerRole,
	employeeRole,
	sellerRole,
} from "@/lib/permissions";

export const auth = betterAuth({
	basePath: "/api",
	database: drizzleAdapter(db, {
		provider: "pg",
	}),
	user: {
		additionalFields: {
			firstName: {
				type: "string",
				required: false,
			},
			lastName: {
				type: "string",
				required: false,
			},
			birthDate: {
				type: "string",
				required: false,
			},
		},
	},
	plugins: [
		openAPI(),
		admin({
			ac,
			roles: {
				admin: adminRole,
				customer: customerRole,
				seller: sellerRole,
				employee: employeeRole,
			},
		}),
	],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
	// better-auth's own limiter is off in dev by default; the frontends sign in
	// via the native /auth/api/sign-in/email endpoint (better-auth client), which
	// our custom /register/* limiter never sees. Enable it in every environment so
	// the native auth primitives are throttled. The generic default stays loose
	// (100 req / 10s) so it never throttles server-side session checks; sensitive
	// paths are tightened below. Unmatched paths still fall back to better-auth's
	// built-in strict rules for /sign-in* and /sign-up*.
	rateLimit: {
		enabled: true,
		customRules: {
			"/sign-in/email": { window: 60, max: 10 },
			"/sign-up/email": { window: 3600, max: 5 },
			"/send-verification-email": { window: 3600, max: 5 },
			"/forget-password": { window: 3600, max: 5 },
		},
	},
	emailVerification: {
		sendOnSignUp: false,
		sendVerificationEmail: async ({ user, url }) => {
			// better-auth generates URLs using basePath "/api", but the handler
			// is mounted at "/auth" in Elysia, so the public path is "/auth/api/..."
			const fixed = new URL(url);
			fixed.pathname = `/auth${fixed.pathname}`;
			const verifyUrl = fixed.toString();

			const { subject, html } = await renderVerificationEmail({
				name: user.name,
				verifyUrl,
			});
			await sendEmail({ to: user.email, subject, html });
		},
		afterEmailVerification: async (user) => {
			// For sellers: advance onboarding from pending_email → pending_personal
			const userRecord = await db.query.user.findFirst({
				where: eq(userTable.id, user.id),
				columns: { role: true },
			});
			if (userRecord?.role === "seller") {
				// Only advance from the initial state, so a future re-verification /
				// email-change flow can never roll a later onboarding step backward.
				await db
					.update(sellerProfile)
					.set({ onboardingStatus: "pending_personal" })
					.where(
						and(
							eq(sellerProfile.userId, user.id),
							eq(sellerProfile.onboardingStatus, "pending_email"),
						),
					);
			}
		},
	},
	trustedOrigins: [
		"http://localhost:3001", // customer
		"http://localhost:3002", // seller
		"http://localhost:3003", // admin
	],
});

let _schema: ReturnType<typeof auth.api.generateOpenAPISchema>;
const getSchema = async () => (_schema ??= auth.api.generateOpenAPISchema());

export const OpenAPI = {
	getPaths: (prefix = "/auth/api") =>
		getSchema().then(({ paths }) => {
			const reference: typeof paths = Object.create(null);

			for (const path of Object.keys(paths)) {
				const key = prefix + path;
				reference[key] = paths[path];

				for (const method of Object.keys(paths[path])) {
					const operation = (reference[key] as any)[method];

					operation.tags = ["Better Auth"];
				}
			}

			return reference;
		}) as Promise<any>,
	components: getSchema().then(({ components }) => components) as Promise<any>,
} as const;
