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

// Variante senza revival delle date: alcune caratteristiche testuali (es.
// "Scadenza/TMC") accettano un testo libero che può somigliare a una data
// (es. "05/03/2027"); con il client di default Eden lo trasformerebbe in un
// `Date` sbagliato. Usare solo dove la risposta può contenere valori di
// caratteristiche di tipo testo (es. il dettaglio prodotto in modifica).
export const apiNoDates = createApiClient<App>(API_URL, { parseDate: false });

// edenMessage/unwrap are generic Eden helpers shared from @bibs/ui; re-exported
// here so the seller's existing `@/lib/api` import sites keep working.
export { edenMessage, unwrap } from "@bibs/ui/lib/api-client";
