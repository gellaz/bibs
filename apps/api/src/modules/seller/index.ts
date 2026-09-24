import { Elysia } from "elysia";
import { ServiceError } from "@/lib/errors";
import { betterAuth } from "@/plugins/better-auth";
import { resolveSellerAccess } from "./context";
import { billingRoutes } from "./routes/billing";
import { brandsRoutes } from "./routes/brands";
import { checkoutRoutes } from "./routes/checkout";
import { closuresRoutes } from "./routes/closures";
import { discountsRoutes } from "./routes/discounts";
import { employeesRoutes } from "./routes/employees";
import { imagesRoutes } from "./routes/images";
import { onboardingRoutes } from "./routes/onboarding";
import { ordersRoutes } from "./routes/orders";
import { productCharacteristicsRoutes } from "./routes/product-characteristics";
import { productsRoutes } from "./routes/products";
import { profileRoutes } from "./routes/profile";
import { settingsRoutes } from "./routes/settings";
import { stockRoutes } from "./routes/stock";
import { storeImagesRoutes } from "./routes/store-images";
import { storesRoutes } from "./routes/stores";

export const sellerModule = new Elysia({ prefix: "/seller" })
	.use(betterAuth)
	// Profile routes: accessible to sellers without VAT verification
	.guard(
		{
			auth: true,
			detail: {
				security: [{ bearerAuth: [] }],
			},
		},
		(app) =>
			app
				.resolve(({ user: u }) => {
					if (u.role !== "seller") {
						throw new ServiceError(403, "Only sellers can access profile");
					}
				})
				.use(profileRoutes)
				.use(onboardingRoutes),
	)
	// Other routes: require verified VAT
	.guard(
		{
			auth: true,
			detail: {
				security: [{ bearerAuth: [] }],
			},
		},
		(app) =>
			app
				.resolve(({ user: u }) => resolveSellerAccess(u))
				// Mount all sub-route plugins
				.use(billingRoutes)
				.use(storesRoutes)
				.use(closuresRoutes)
				.use(checkoutRoutes)
				.use(productsRoutes)
				.use(productCharacteristicsRoutes)
				.use(brandsRoutes)
				.use(imagesRoutes)
				.use(storeImagesRoutes)
				.use(stockRoutes)
				.use(ordersRoutes)
				.use(employeesRoutes)
				.use(settingsRoutes)
				.use(discountsRoutes),
	);
