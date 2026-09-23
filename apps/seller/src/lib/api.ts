import type { App } from "@bibs/api";
import { createApiClient } from "@bibs/ui/lib/api-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const api = createApiClient<App>(API_URL);

// Variante senza revival delle date: alcune caratteristiche testuali (es.
// "Scadenza/TMC") accettano un testo libero che può somigliare a una data
// (es. "05/03/2027"); con il client di default Eden lo trasformerebbe in un
// `Date` sbagliato. Usare solo dove la risposta può contenere valori di
// caratteristiche di tipo testo (es. il dettaglio prodotto in modifica).
export const apiNoDates = createApiClient<App>(API_URL, { parseDate: false });

// edenMessage/unwrap are generic Eden helpers shared from @bibs/ui; re-exported
// here so the seller's existing `@/lib/api` import sites keep working.
export { edenMessage, unwrap } from "@bibs/ui/lib/api-client";
