import type {
	App,
	LocationsApp,
	MeApp,
	RegistrationApp,
	SellerApp,
} from "@bibs/api";
import { createApiClient, type WithErrors } from "@bibs/ui/lib/api-client";
import { hc } from "hono/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const api = createApiClient<App>(API_URL);

// Client `hc` per i moduli già su Hono: uno per sotto-albero. Le date
// arrivano come stringhe ISO e i testi restano testi (niente revival di Eden).
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
// /seller in parte: prodotti, brand, immagini, caratteristiche, stock (U5).
export const sellerApi = hc<WithErrors<SellerApp>>(`${API_URL}/seller`, {
	init,
});

// edenMessage/unwrap are generic Eden helpers shared from @bibs/ui; re-exported
// here so the seller's existing `@/lib/api` import sites keep working.
export { edenMessage, unwrap } from "@bibs/ui/lib/api-client";
