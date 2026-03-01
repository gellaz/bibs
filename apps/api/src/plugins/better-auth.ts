import { Elysia } from "elysia";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";

export const betterAuth = new Elysia({ name: "better-auth" })
	.mount("/auth", auth.handler)
	.macro({
		auth: {
			async resolve({ request: { headers } }) {
				const session = await auth.api.getSession({
					headers,
				});
				if (!session) throw new ServiceError(401, "Authentication required");
				return {
					user: session.user,
					session: session.session,
				};
			},
		},
	});
