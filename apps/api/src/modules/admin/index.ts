import { Elysia } from "elysia";
import { ServiceError } from "@/lib/errors";
import { betterAuth } from "@/plugins/better-auth";
import { categoriesWriteRoutes } from "./routes/categories";
import { configurationsRoutes } from "./routes/configurations";
import { sellerChangesRoutes } from "./routes/seller-changes";
import { sellersRoutes } from "./routes/sellers";
import { storeCategoriesWriteRoutes } from "./routes/store-categories";

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
				.use(categoriesWriteRoutes)
				.use(configurationsRoutes)
				.use(storeCategoriesWriteRoutes)
				.use(sellersRoutes)
				.use(sellerChangesRoutes),
	);
