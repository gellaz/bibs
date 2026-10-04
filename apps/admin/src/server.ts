import handler from "@tanstack/react-start/server-entry";
import { paraglideMiddleware } from "./paraglide/server.js";

/**
 * Entry server di TanStack Start avvolto da Paraglide: il middleware legge il
 * cookie della lingua e la tiene in AsyncLocalStorage per tutto il render,
 * così `getLocale()` (e `<html lang>`) è quello della richiesta già in SSR.
 * Con la strategia cookie non riscrive l'URL: si passa la richiesta originale.
 */
export default {
	fetch(req: Request): Promise<Response> {
		return paraglideMiddleware(req, () => handler.fetch(req));
	},
};
