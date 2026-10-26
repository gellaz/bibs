import { Elysia } from "elysia";
import { moduleApp } from "@/http/app";
import type { ModuleGuard } from "@/http/routes";
import { ServiceError } from "@/lib/errors";
import { betterAuth } from "@/plugins/better-auth";
import { resolveSellerAccess } from "./context";
import { billingRoutes } from "./routes/billing";
import { brandsRoutes } from "./routes/brands";
import { checkoutRoutes } from "./routes/checkout";
import { closuresRoutes } from "./routes/closures";
import { dashboardRoutes } from "./routes/dashboard";
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

/**
 * Sub-app Hono del modulo, montata su /seller in `src/index.ts` (strangler,
 * migrazione Hono): le route seller ancora Elysia (`sellerModule`, U6)
 * vincono sul mount. Ogni route porta la sua guardia (`requireSeller`).
 * In Hono risponde la prima route registrata: il checkout (`/stores/checkout`,
 * `/stores/checkout/:pendingId`) sta prima delle route `/stores/:storeId/…`
 * di U6, come la precedenza statica di Elysia.
 */
export const sellerApp = moduleApp()
	.route("/", productsRoutes)
	.route("/", productCharacteristicsRoutes)
	.route("/", brandsRoutes)
	.route("/", imagesRoutes)
	.route("/", stockRoutes)
	.route("/", billingRoutes)
	.route("/", checkoutRoutes)
	.route("/", ordersRoutes)
	.route("/", discountsRoutes);

/** Tipo per il client `hc` del seller (`hc<SellerApp>(`${API_URL}/seller`)`). */
export type SellerApp = typeof sellerApp;

/**
 * Le guardie del modulo route per route (`honoPaths` in `src/index.ts`, D9):
 * profilo e onboarding accettano anche chi non ha la partita IVA verificata
 * (`requireSellerRole`, oggi il primo `.guard` qui sotto), il resto vuole
 * `requireSeller`. Così una route operativa con la sola `requireSellerRole`
 * ferma l'avvio.
 */
export const sellerGuards = (path: string): readonly ModuleGuard[] =>
	path === "/profile" || path.startsWith("/onboarding/")
		? ["sellerRole"]
		: ["seller"];

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
						throw new ServiceError(403, "Accesso riservato ai venditori");
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
				// Mount all sub-route plugins (products, brands, images,
				// product-characteristics, stock, billing, checkout, orders and
				// discounts are on Hono: `sellerApp`)
				.use(storesRoutes)
				.use(closuresRoutes)
				.use(storeImagesRoutes)
				.use(dashboardRoutes)
				.use(employeesRoutes)
				.use(settingsRoutes),
	);
