import type { App } from "@bibs/api";
import { treaty } from "@elysiajs/eden";
import { createIsomorphicFn } from "@tanstack/react-start";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Eden Treaty client isomorfo per TanStack Start.
 *
 * - **Server (SSR/loaders)**: chiama l'API direttamente via HTTP interno
 * - **Client (browser)**: chiama l'API via HTTP dal browser
 *
 * Entrambi usano `credentials: "include"` per i cookie di autenticazione.
 */
export const api = createIsomorphicFn()
	.server(() =>
		treaty<App>(API_URL, {
			fetch: { credentials: "include" as RequestCredentials },
		}),
	)
	.client(() =>
		treaty<App>(API_URL, {
			fetch: { credentials: "include" as RequestCredentials },
		}),
	);
