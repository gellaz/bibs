import { moduleApp } from "@/http/app";
import type { ModuleGuard } from "@/http/routes";
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
 * Sub-app Hono del modulo, montata su /seller in `src/index.ts`. Ogni route
 * porta la sua guardia: `requireSellerRole` per profilo e onboarding,
 * `requireSeller` per il resto. In Hono risponde la prima route registrata:
 * il checkout (`/stores/checkout`, `/stores/checkout/:pendingId`) sta prima
 * delle route `/stores/:storeId/…`, come la precedenza statica di Elysia.
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
	.route("/", discountsRoutes)
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
