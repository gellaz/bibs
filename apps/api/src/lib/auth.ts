import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, openAPI } from "better-auth/plugins";
import { eq } from "drizzle-orm";
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
	emailVerification: {
		sendOnSignUp: false,
		sendVerificationEmail: async ({ user, url }) => {
			// better-auth generates URLs using basePath "/api", but the handler
			// is mounted at "/auth" in Elysia, so the public path is "/auth/api/..."
			const fixed = new URL(url);
			fixed.pathname = `/auth${fixed.pathname}`;
			const verifyUrl = fixed.toString();

			await sendEmail({
				to: user.email,
				subject: "Verifica il tuo indirizzo email — Bibs",
				html: `<p>Ciao ${user.name},</p><p>Clicca sul link per verificare il tuo indirizzo email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
			});
		},
		afterEmailVerification: async (user) => {
			// For sellers: advance onboarding from pending_email → pending_personal
			const userRecord = await db.query.user.findFirst({
				where: eq(userTable.id, user.id),
				columns: { role: true },
			});
			if (userRecord?.role === "seller") {
				await db
					.update(sellerProfile)
					.set({ onboardingStatus: "pending_personal" })
					.where(eq(sellerProfile.userId, user.id));
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
