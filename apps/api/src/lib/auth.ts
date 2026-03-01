import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, openAPI } from "better-auth/plugins";
import { db } from "@/db";
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
