/**
 * Re-export dei tipi per Eden Treaty e better-auth.
 * Questo file esporta solo tipi senza importare dipendenze,
 * per evitare problemi di risoluzione dei path alias quando
 * i tipi vengono importati da altri workspace.
 */
export type { App } from "./index";
export type { auth } from "./lib/auth";
