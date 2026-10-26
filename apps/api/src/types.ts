/**
 * Re-export dei tipi per Eden Treaty e better-auth.
 * Questo file esporta solo tipi senza importare dipendenze,
 * per evitare problemi di risoluzione dei path alias quando
 * i tipi vengono importati da altri workspace.
 */
export type { App } from "./index";
export type { auth } from "./lib/auth";
// Client `hc` per sotto-albero (migrazione Hono): uno per sub-app montata.
export type { LocationsApp } from "./modules/locations";
export type { MeApp } from "./modules/me";
export type { RegistrationApp } from "./modules/registration";
export type { SellerApp } from "./modules/seller";
