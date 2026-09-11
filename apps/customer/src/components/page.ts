/**
 * Griglia di pagina del customer: un solo container per la top bar e per le
 * pagine larghe (home, /stores, scheda negozio), così la barra e il contenuto
 * cadono sempre sulla stessa colonna anche su monitor molto grandi.
 *
 * Le pagine-form (login, carrello, profilo) restano su misure proprie: lì la
 * larghezza la decide la riga di lettura, non lo schermo.
 */
export const PAGE_CONTAINER = "mx-auto w-full max-w-7xl px-4 sm:px-6";
