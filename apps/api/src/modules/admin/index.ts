import { moduleApp } from "@/http/app";
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
 * tassonomia, caratteristiche, festività e import CSV (U8 del piano Hono);
 * venditori, modifiche del profilo, negozi, richieste e billing (U9).
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
	.route("/", characteristicImportsRoutes)
	.route("/", sellersRoutes)
	.route("/", storesRoutes)
	.route("/", sellerChangesRoutes)
	.route("/", requestsRoutes)
	.route("/", adminBillingRoutes);

/** Tipo per il client `hc` dei frontend (`hc<AdminApp>(`${API_URL}/admin`)`). */
export type AdminApp = typeof adminApp;
