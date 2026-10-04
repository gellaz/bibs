import { Elysia } from "elysia";
import { productCategoriesRoutes } from "./routes/product-categories";
import { productMacroCategoriesRoutes } from "./routes/product-macro-categories";
import { storeCategoriesRoutes } from "./routes/store-categories";
import { storeMacroCategoriesRoutes } from "./routes/store-macro-categories";

/** Public taxonomy listings (no auth). Writes live in `admin/`. */
export const catalogModule = new Elysia()
	.use(productMacroCategoriesRoutes)
	.use(productCategoriesRoutes)
	.use(storeMacroCategoriesRoutes)
	.use(storeCategoriesRoutes);
