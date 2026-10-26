import { moduleApp } from "@/http/app";
import { locationsRoutes } from "./routes/locations";

/**
 * Sub-app Hono del modulo, montata su /locations in `src/app.ts`. Modulo
 * misto: /geocode con `requireAuth`, le altre route con `publicRoute`.
 */
export const locationsApp = moduleApp().route("/", locationsRoutes);

/** Tipo per il client `hc` dei frontend (`hc<LocationsApp>(`${API_URL}/locations`)`). */
export type LocationsApp = typeof locationsApp;
