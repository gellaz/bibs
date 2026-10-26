import type {
	App,
	CustomerApp,
	LocationsApp,
	MeApp,
	RegistrationApp,
} from "@bibs/api";
import { createApiClient, type WithErrors } from "@bibs/ui/lib/api-client";
import { hc } from "hono/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const api = createApiClient<App>(API_URL);

// Client `hc` per i moduli già su Hono: uno per sotto-albero. `hc` non
// trasforma le stringhe in `Date`: il testo libero («Scadenza/TMC:
// 05/03/2027») resta testo, le date restano stringhe ISO.
const init = { credentials: "include" } satisfies RequestInit;
export const meApi = hc<WithErrors<MeApp>>(`${API_URL}/me`, { init });
export const customerApi = hc<WithErrors<CustomerApp>>(`${API_URL}/customer`, {
	init,
});
export const locationsApi = hc<WithErrors<LocationsApp>>(
	`${API_URL}/locations`,
	{ init },
);
export const registerApi = hc<WithErrors<RegistrationApp>>(
	`${API_URL}/register`,
	{ init },
);
