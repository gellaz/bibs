import type { AdminApp, CatalogApp, MeApp } from "@bibs/api";
import type { WithErrors } from "@bibs/ui/lib/api-client";
import { hc } from "hono/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

// Client `hc` per sotto-albero dell'API.
const init = { credentials: "include" } satisfies RequestInit;
export const meApi = hc<WithErrors<MeApp>>(`${API_URL}/me`, { init });
export const adminApi = hc<WithErrors<AdminApp>>(`${API_URL}/admin`, { init });
// Le liste pubbliche della tassonomia: quattro path radice in un client.
export const catalogApi = hc<WithErrors<CatalogApp>>(API_URL, { init });
