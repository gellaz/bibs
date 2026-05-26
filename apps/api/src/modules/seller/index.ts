import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "@/db";
import { storeEmployee } from "@/db/schemas/employee";
import { sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";
import { betterAuth } from "@/plugins/better-auth";
import { getAccessibleStoreIdsFor, getSellerStoreIds } from "./context";
import { billingRoutes } from "./routes/billing";
import { brandsRoutes } from "./routes/brands";
import { checkoutRoutes } from "./routes/checkout";
import { discountsRoutes } from "./routes/discounts";
import { employeesRoutes } from "./routes/employees";
import { imagesRoutes } from "./routes/images";
import { onboardingRoutes } from "./routes/onboarding";
import { ordersRoutes } from "./routes/orders";
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
				.resolve(async ({ user: u }) => {
					// Owner path: user is a seller with completed onboarding
					if (u.role === "seller") {
						const profile = await db.query.sellerProfile.findFirst({
							where: eq(sellerProfile.userId, u.id),
						});

						if (!profile)
							throw new ServiceError(403, "Seller profile not found");
						if (profile.onboardingStatus !== "active")
							throw new ServiceError(403, "Seller onboarding not completed");

						let cached: Promise<string[]> | null = null;
						const getStoreIds = () =>
							(cached ??= getSellerStoreIds(profile.id));

						let cachedAccessible: Promise<string[]> | null = null;
						const getAccessibleStoreIds = () =>
							(cachedAccessible ??= getAccessibleStoreIdsFor({
								userId: u.id,
								sellerProfileId: profile.id,
								isOwner: true,
							}));

						return {
							sellerProfile: profile,
							isOwner: true as const,
							getStoreIds,
							getAccessibleStoreIds,
						};
					}

					// Employee path: user is an active employee
					if (u.role === "employee") {
						const emp = await db.query.storeEmployee.findFirst({
							where: and(
								eq(storeEmployee.userId, u.id),
								eq(storeEmployee.status, "active"),
							),
							with: { sellerProfile: true },
						});

						if (!emp) throw new ServiceError(403, "Employee access denied");
						let cached: Promise<string[]> | null = null;
						const getStoreIds = () =>
							(cached ??= getSellerStoreIds(emp.sellerProfile.id));

						let cachedAccessible: Promise<string[]> | null = null;
						const getAccessibleStoreIds = () =>
							(cachedAccessible ??= getAccessibleStoreIdsFor({
								userId: u.id,
								sellerProfileId: emp.sellerProfile.id,
								isOwner: false,
							}));

						return {
							sellerProfile: emp.sellerProfile,
							isOwner: false as const,
							getStoreIds,
							getAccessibleStoreIds,
						};
					}

					throw new ServiceError(403, "Not a seller or employee");
				})
				// Mount all sub-route plugins
				.use(billingRoutes)
				.use(storesRoutes)
				.use(checkoutRoutes)
				.use(productsRoutes)
				.use(brandsRoutes)
				.use(imagesRoutes)
				.use(storeImagesRoutes)
				.use(stockRoutes)
				.use(ordersRoutes)
				.use(employeesRoutes)
				.use(settingsRoutes)
				.use(discountsRoutes),
	);
