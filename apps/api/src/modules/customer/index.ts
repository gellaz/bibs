import { moduleApp } from "@/http/app";
import { addressesRoutes } from "./routes/addresses";
import { cartRoutes } from "./routes/cart";
import { checkoutRoutes } from "./routes/checkout";
import { ordersRoutes } from "./routes/orders";
import { pointsRoutes } from "./routes/points";
import { productsRoutes } from "./routes/products";
import { profileRoutes } from "./routes/profile";
import { storesRoutes } from "./routes/stores";

/**
 * Sub-app Hono del modulo, montata su /customer in `src/index.ts`. Prodotti e
 * negozi sono pubblici (`publicRoute`); il resto ha `requireCustomer` in ogni
 * route, dopo i suoi `v(...)`.
 */
export const customerApp = moduleApp()
	.route("/", productsRoutes)
	.route("/", storesRoutes)
	.route("/", profileRoutes)
	.route("/", addressesRoutes)
	.route("/", pointsRoutes)
	.route("/", ordersRoutes)
	.route("/", cartRoutes)
	.route("/", checkoutRoutes);

/** Tipo per il client `hc` dei frontend (`hc<CustomerApp>(`${API_URL}/customer`)`). */
export type CustomerApp = typeof customerApp;
