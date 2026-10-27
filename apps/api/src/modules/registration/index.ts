import { moduleApp } from "@/http/app";
import { registrationRoutes } from "./routes/registration";

/**
 * Sub-app Hono del modulo, montata su /register in `src/app.ts`: quattro
 * POST pubblici, ognuno col suo rate limit dopo la validazione.
 */
export const registrationApp = moduleApp().route("/", registrationRoutes);

/** Tipo per il client `hc` dei frontend (`hc<RegistrationApp>(`${API_URL}/register`)`). */
export type RegistrationApp = typeof registrationApp;
