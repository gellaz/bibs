import { moduleApp } from "@/http/app";
import { avatarRoutes } from "./routes/avatar";

/** Sub-app Hono del modulo, montata su /me in `src/app.ts`. */
export const meApp = moduleApp().route("/", avatarRoutes);

/** Tipo per il client `hc` dei frontend (`hc<MeApp>(`${API_URL}/me`)`). */
export type MeApp = typeof meApp;
