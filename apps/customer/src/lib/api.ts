import type { App } from "@bibs/api";
import { createApiClient } from "@bibs/ui/lib/api-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const api = createApiClient<App>(API_URL);

/**
 * Per le risposte che portano testo libero: le caratteristiche di un prodotto
 * («Scadenza/TMC: 05/03/2027»). Con il default di Eden quel testo diventerebbe
 * un `Date` del 3 maggio, senza ritorno. Vedi product-detail-api.test.ts.
 */
export const apiNoDates = createApiClient<App>(API_URL, { parseDate: false });
