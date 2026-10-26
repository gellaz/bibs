import { Elysia } from "elysia";
import { moduleApp } from "@/http/app";
import type { ModuleGuard } from "@/http/routes";
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
 * migrazione Hono): le route seller ancora Elysia (`sellerModule`, U7)
 * vincono sul mount. Ogni route porta la sua guardia: `requireSellerRole`
 * per profilo e onboarding, `requireSeller` per il resto.
 */
export const sellerApp = moduleApp()
	.route("/", productsRoutes)
	.route("/", productCharacteristicsRoutes)
	.route("/", brandsRoutes)
	.route("/", imagesRoutes)
	.route("/", stockRoutes)
	.route("/", profileRoutes)
	.route("/", onboardingRoutes)
	.route("/", storesRoutes)
	.route("/", closuresRoutes)
	.route("/", storeImagesRoutes)
	.route("/", dashboardRoutes)
	.route("/", employeesRoutes)
	.route("/", settingsRoutes);

/** Tipo per il client `hc` del seller (`hc<SellerApp>(`${API_URL}/seller`)`). */
export type SellerApp = typeof sellerApp;

/**
 * Le guardie del modulo route per route (`honoPaths` in `src/index.ts`, D9):
 * profilo e onboarding accettano anche chi non ha la partita IVA verificata
 * (`requireSellerRole`), il resto vuole `requireSeller`. Così una route
 * operativa con la sola `requireSellerRole` ferma l'avvio.
 */
export const sellerGuards = (path: string): readonly ModuleGuard[] =>
	path === "/profile" || path.startsWith("/onboarding/")
		? ["sellerRole"]
		: ["seller"];

export const sellerModule = new Elysia({ prefix: "/seller" })
	.use(betterAuth)
	// Route operative (U7): partita IVA verificata
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
				// Le altre sub-route sono su Hono (`sellerApp`)
				.use(billingRoutes)
				.use(checkoutRoutes)
				.use(ordersRoutes)
				.use(discountsRoutes),
	);
