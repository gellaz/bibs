import type { AdminApp, App, CatalogApp, MeApp } from "@bibs/api";
import { createApiClient, type WithErrors } from "@bibs/ui/lib/api-client";
import { hc } from "hono/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const api = createApiClient<App>(API_URL);

// Client `hc` per i moduli già su Hono: uno per sotto-albero.
const init = { credentials: "include" } satisfies RequestInit;
export const meApi = hc<WithErrors<MeApp>>(`${API_URL}/me`, { init });
export const adminApi = hc<WithErrors<AdminApp>>(`${API_URL}/admin`, { init });
// Le liste pubbliche della tassonomia: quattro path radice in un client.
export const catalogApi = hc<WithErrors<CatalogApp>>(API_URL, { init });
