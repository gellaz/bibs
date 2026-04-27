import { Elysia } from "elysia";
import { ServiceError } from "@/lib/errors";
import { betterAuth } from "@/plugins/better-auth";
import { categoryImportsRoutes } from "./routes/category-imports";
import { configurationsRoutes } from "./routes/configurations";
import { productCategoriesWriteRoutes } from "./routes/product-categories";
import { productMacroCategoriesWriteRoutes } from "./routes/product-macro-categories";
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
				.use(productMacroCategoriesWriteRoutes)
				.use(productCategoriesWriteRoutes)
				.use(configurationsRoutes)
				.use(storeCategoriesWriteRoutes)
				.use(categoryImportsRoutes)
				.use(sellersRoutes)
				.use(sellerChangesRoutes),
	);
