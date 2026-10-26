/**
 * Re-export dei tipi per i client `hc` dei frontend e per better-auth.
 * Questo file esporta solo tipi senza importare dipendenze,
 * per evitare problemi di risoluzione dei path alias quando
 * i tipi vengono importati da altri workspace.
 */
export type { auth } from "./infra/auth";
// Un client `hc` per sotto-albero: uno per sub-app.
export type { AdminApp } from "./modules/admin";
export type { CatalogApp } from "./modules/catalog";
export type { CustomerApp } from "./modules/customer";
export type { LocationsApp } from "./modules/locations";
export type { MeApp } from "./modules/me";
export type { RegistrationApp } from "./modules/registration";
export type { SellerApp } from "./modules/seller";
