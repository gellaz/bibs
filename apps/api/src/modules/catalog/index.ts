import { Hono } from "hono";
import { moduleApp } from "@/http/app";
import { productCategoriesRoutes } from "./routes/product-categories";
import { productMacroCategoriesRoutes } from "./routes/product-macro-categories";
import { storeCategoriesRoutes } from "./routes/store-categories";
import { storeMacroCategoriesRoutes } from "./routes/store-macro-categories";

// Liste pubbliche della tassonomia (senza auth); le scritture stanno in admin/.
// Quattro path radice → quattro sub-app, ognuna montata sul suo path in
// `src/index.ts` (il mount toglie il prefisso: la route è "/").

export const productMacroCategoriesApp = moduleApp().route(
	"/",
	productMacroCategoriesRoutes,
);
export const productCategoriesApp = moduleApp().route(
	"/",
	productCategoriesRoutes,
);
export const storeMacroCategoriesApp = moduleApp().route(
	"/",
	storeMacroCategoriesRoutes,
);
export const storeCategoriesApp = moduleApp().route("/", storeCategoriesRoutes);

// Solo per il tipo del client `hc` dei FE: i quattro path in un client
// (`hc<CatalogApp>(API_URL)["product-categories"].$get(…)`).
const catalogTypes = new Hono()
	.route("/product-macro-categories", productMacroCategoriesRoutes)
	.route("/product-categories", productCategoriesRoutes)
	.route("/store-macro-categories", storeMacroCategoriesRoutes)
	.route("/store-categories", storeCategoriesRoutes);

/** Tipo per il client `hc` dei frontend (`hc<CatalogApp>(API_URL)`). */
export type CatalogApp = typeof catalogTypes;
