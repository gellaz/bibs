import type { App, LocationsApp, MeApp, RegistrationApp } from "@bibs/api";
import { createApiClient, type WithErrors } from "@bibs/ui/lib/api-client";
import { hc } from "hono/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const api = createApiClient<App>(API_URL);

// Client `hc` per i moduli già su Hono: uno per sotto-albero.
const init = { credentials: "include" } satisfies RequestInit;
export const meApi = hc<WithErrors<MeApp>>(`${API_URL}/me`, { init });
export const locationsApi = hc<WithErrors<LocationsApp>>(
	`${API_URL}/locations`,
	{ init },
);
export const registerApi = hc<WithErrors<RegistrationApp>>(
	`${API_URL}/register`,
	{ init },
);

/**
 * Per le risposte che portano testo libero: le caratteristiche di un prodotto
 * («Scadenza/TMC: 05/03/2027»). Con il default di Eden quel testo diventerebbe
 * un `Date` del 3 maggio, senza ritorno. Vedi product-detail-api.test.ts.
 */
export const apiNoDates = createApiClient<App>(API_URL, { parseDate: false });
