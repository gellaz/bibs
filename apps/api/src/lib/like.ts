/**
 * Testo utente dentro un pattern `LIKE`/`ILIKE`: `%` e `_` sono jolly, quindi
 * cercare "_" troverebbe tutto. Postgres usa `\` come carattere di escape di
 * default, che va a sua volta raddoppiato.
 */
export function escapeLike(text: string): string {
	return text.replace(/[\\%_]/g, "\\$&");
}

/** Pattern "contiene il testo", con i jolly del testo neutralizzati. */
export function containsPattern(text: string): string {
	return `%${escapeLike(text)}%`;
}

/** Pattern "inizia con il testo", con i jolly del testo neutralizzati. */
export function prefixPattern(text: string): string {
	return `${escapeLike(text)}%`;
}
