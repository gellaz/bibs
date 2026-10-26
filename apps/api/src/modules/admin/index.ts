import { Elysia } from "elysia";
import { moduleApp } from "@/http/app";
import { ServiceError } from "@/lib/errors";
import { betterAuth } from "@/plugins/better-auth";
import { adminBillingRoutes } from "./routes/billing";
import { categoryCharacteristicsRoutes } from "./routes/category-characteristics";
import { categoryImportsRoutes } from "./routes/category-imports";
import { characteristicImportsRoutes } from "./routes/characteristic-imports";
import { configurationsRoutes } from "./routes/configurations";
import { holidayDefinitionsRoutes } from "./routes/holiday-definitions";
import { productCategoriesWriteRoutes } from "./routes/product-categories";
import { productCharacteristicsRoutes } from "./routes/product-characteristics";
import { productMacroCategoriesWriteRoutes } from "./routes/product-macro-categories";
import { requestsRoutes } from "./routes/requests";
import { sellerChangesRoutes } from "./routes/seller-changes";
import { sellersRoutes } from "./routes/sellers";
import { storeCategoriesWriteRoutes } from "./routes/store-categories";
import { storeMacroCategoriesWriteRoutes } from "./routes/store-macro-categories";
import { storesRoutes } from "./routes/stores";

/**
 * Sub-app Hono del modulo, montata su /admin in `src/index.ts`: configurazioni,
 * tassonomia, caratteristiche, festività e import CSV (U8 del piano Hono).
 * Ogni route ha `requireAdmin` dopo i suoi `v(...)`.
 */
export const adminApp = moduleApp()
	.route("/", productMacroCategoriesWriteRoutes)
	.route("/", productCategoriesWriteRoutes)
	.route("/", categoryCharacteristicsRoutes)
	.route("/", configurationsRoutes)
	.route("/", storeMacroCategoriesWriteRoutes)
	.route("/", storeCategoriesWriteRoutes)
	.route("/", holidayDefinitionsRoutes)
	.route("/", categoryImportsRoutes)
	.route("/", productCharacteristicsRoutes)
	.route("/", characteristicImportsRoutes);

/** Tipo per il client `hc` dei frontend (`hc<AdminApp>(`${API_URL}/admin`)`). */
export type AdminApp = typeof adminApp;

// Route admin ancora su Elysia (U9): vincono sul mount di /admin.
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
						throw new ServiceError(
							403,
							"Accesso riservato agli amministratori",
						);
					return {};
				})
				.use(sellersRoutes)
				.use(storesRoutes)
				.use(sellerChangesRoutes)
				.use(requestsRoutes)
				.use(adminBillingRoutes),
	);
