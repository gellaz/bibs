/**
 * Un punto, nella forma che le query dell'API già parlano (`lat`/`lng`). Vive
 * da solo perché lo importano hook, componenti e dominio puro: un tipo di base
 * non deve trascinarsi dietro un hook di React.
 */
export interface Coords {
	lat: number;
	lng: number;
}
