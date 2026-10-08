/**
 * Griglia di pagina del customer: un solo container per la top bar e per le
 * pagine larghe (home, /stores, scheda negozio), così la barra e il contenuto
 * cadono sempre sulla stessa colonna anche su monitor molto grandi.
 *
 * Da `2xl` il tetto sale a 110rem: su un 27" a 2560px il contenuto teneva metà
 * schermo. Lo spazio in più diventa colonne in più nelle griglie, non tile
 * gonfiate (vedi `GRID` in tile.tsx).
 */
export const PAGE_CONTAINER =
	"mx-auto w-full max-w-7xl px-4 sm:px-6 2xl:max-w-[110rem] 2xl:px-10";

/**
 * Pagine-form e di account (ordini, profilo, carrello, checkout): la larghezza
 * la decide la riga di lettura, non lo schermo. La colonna resta stretta ma
 * parte dal bordo sinistro del container, sotto il logo, invece di galleggiare
 * al centro di una top bar più larga.
 */
export const NARROW_PAGE = `${PAGE_CONTAINER} *:max-w-3xl`;
