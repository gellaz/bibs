import { Hono } from "hono";
import { errorResponse, notFoundResponse, rawPath } from "@/http/app";
import { honoPaths } from "@/http/openapi";
import type { ModuleGuards } from "@/http/routes";
import { adminApp } from "@/modules/admin";
import {
	productCategoriesApp,
	productMacroCategoriesApp,
	storeCategoriesApp,
	storeMacroCategoriesApp,
} from "@/modules/catalog";
import { customerApp } from "@/modules/customer";
import { locationsApp } from "@/modules/locations";
import { meApp } from "@/modules/me";
import { registrationApp } from "@/modules/registration";
import { sellerApp, sellerGuards } from "@/modules/seller";
import { webhooksApp } from "@/modules/webhooks";
import { authHandler, socketIpAsForwardedFor } from "@/plugins/better-auth";
import { cors } from "@/plugins/cors";
import { healthRoutes } from "@/plugins/health";
import { openapiRoutes } from "@/plugins/openapi";
import { requestId } from "@/plugins/request-id";
import { markRootNotFound, requestLog } from "@/plugins/request-log";

// L'app Hono radice dell'API (U11 del piano Hono). Nessun effetto all'import:
// niente server, niente cron, niente S3 (li avvia `src/index.ts`); così la
// importano anche i test, gli strumenti del piano e la Hono CLI.

/**
 * Le sub-app dei moduli con il loro prefisso e le guardie che ogni loro route
 * deve avere (D9): `honoPaths` le controlla qui, all'import, e un errore ferma
 * l'avvio.
 */
const MODULES: [string, Hono<any, any, any>, ModuleGuards][] = [
	["/me", meApp, ["auth"]],
	["/customer", customerApp, ["customer", "publicRoute"]],
	["/register", registrationApp, ["publicRoute"]],
	["/locations", locationsApp, ["auth", "publicRoute"]],
	["/seller", sellerApp, sellerGuards],
	["/admin", adminApp, ["admin"]],
	["/product-macro-categories", productMacroCategoriesApp, ["publicRoute"]],
	["/product-categories", productCategoriesApp, ["publicRoute"]],
	["/store-macro-categories", storeMacroCategoriesApp, ["publicRoute"]],
	["/store-categories", storeCategoriesApp, ["publicRoute"]],
	["/webhooks", webhooksApp, ["publicRoute"]],
];

const paths = Object.assign(
	honoPaths(healthRoutes, "", ["publicRoute"]),
	...MODULES.map(([prefix, sub, guards]) => honoPaths(sub, prefix, guards)),
);

/**
 * La radice senza route: prima la riga di log (misura tutto), poi CORS
 * (risponde al preflight), poi `x-request-id` e la sovrascrittura di
 * `x-forwarded-for` con l'IP del socket, prima di better-auth e di ogni
 * modulo. Errori e 404 col solito inviluppo: un modulo usa i suoi
 * (`moduleApp()`), il resto quelli della radice. I test ci montano le loro
 * sub-app di prova.
 */
export function rootApp() {
	return new Hono({ getPath: rawPath })
		.onError(errorResponse)
		.notFound((c) => {
			markRootNotFound(c.req.raw);
			return notFoundResponse(c);
		})
		.use(requestLog)
		.use(cors)
		.use(requestId)
		.use(socketIpAsForwardedFor);
}

export const app = rootApp()
	.route("/", openapiRoutes(paths))
	.all("/auth/*", authHandler)
	.route("/", healthRoutes);

for (const [prefix, sub] of MODULES) app.route(prefix, sub);
