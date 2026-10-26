import type {
	CatalogApp,
	LocationsApp,
	MeApp,
	RegistrationApp,
	SellerApp,
} from "@bibs/api";
import type { WithErrors } from "@bibs/ui/lib/api-client";
import { hc } from "hono/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

// Client `hc` per sotto-albero (dalla U7 il seller non usa più Eden). Le date
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
export const sellerApi = hc<WithErrors<SellerApp>>(`${API_URL}/seller`, {
	init,
});
// Le liste pubbliche della tassonomia: quattro path radice in un client.
export const catalogApi = hc<WithErrors<CatalogApp>>(API_URL, { init });
