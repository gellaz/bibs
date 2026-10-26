const DIACRITICS = /\p{Diacritic}/gu;

/** Parole che non distinguono una provincia da un'altra. */
const FILLER_WORDS = new Set([
	"e",
	"di",
	"del",
	"della",
	"dell",
	"d",
	"in",
	"la",
	"il",
	"provincia",
	"autonoma",
	"citta",
	"metropolitana",
]);

/** La query come la vede la cache: minuscola, senza spazi ridondanti. */
export function normalizeQuery(q: string): string {
	return q.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Nome di luogo confrontabile: senza diacritici, con apostrofi, trattini e
 * slash ridotti a spazio. `Agliè` → `aglie`, `Pont-Canavese` → `pont canavese`.
 */
export function normalizePlaceName(s: string): string {
	return s
		.normalize("NFD")
		.replace(DIACRITICS, "")
		.replace(/['’]/g, " ")
		.replace(/[-/]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/**
 * Varianti confrontabili di un nome: il nome intero più le due metà di un
 * bilingue. Photon scrive `Bolzano - Bozen`, il nostro seed `Bolzano`, e le
 * province `Bolzano/Bozen`. Lo split richiede spazi attorno al trattino,
 * così `Pont-Canavese` resta intero.
 */
export function placeNameVariants(s: string): string[] {
	const parts = s
		.split(/ - |\//g)
		.map((part) => normalizePlaceName(part))
		.filter(Boolean);
	return [...new Set([normalizePlaceName(s), ...parts])];
}

/** Token significativi, per confrontare due modi di scrivere una provincia. */
export function placeTokens(s: string): string[] {
	return normalizePlaceName(s)
		.split(" ")
		.filter((token) => token.length > 0 && !FILLER_WORDS.has(token));
}

/** Celle da ~1,1 km: la parte di bias nella chiave di cache. */
export function biasCell(near?: { lat: number; lng: number }): string {
	if (!near) return "-";
	return `${near.lat.toFixed(2)},${near.lng.toFixed(2)}`;
}
