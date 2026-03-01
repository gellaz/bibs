import { Elysia } from "elysia";
import { ServiceError } from "@/lib/errors";
import { betterAuth } from "@/plugins/better-auth";
import { categoriesRoutes } from "./routes/categories";
import { sellersRoutes } from "./routes/sellers";

export const adminModule = new Elysia({ prefix: "/admin", tags: ["Admin"] })
	.use(betterAuth)
	.guard(
		{
			auth: true,
			detail: {
				security: [{ bearerAuth: [] }],
			},
		},
		(app) =>
			app
				.resolve(async ({ user }) => {
					if (user.role !== "admin")
						throw new ServiceError(403, "Admin access required");
					return {};
				})
				.use(categoriesRoutes)
				.use(sellersRoutes),
	);
