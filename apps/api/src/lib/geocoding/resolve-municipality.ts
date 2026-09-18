import {
	normalizePlaceName,
	placeNameVariants,
	placeTokens,
} from "./normalize";

export interface MunicipalityIndexEntry {
	id: string;
	name: string;
	provinceAcronym: string;
	provinceName: string;
}

/** Nome normalizzato → righe che lo portano (più di una solo per gli omonimi). */
export type MunicipalityIndex = Map<string, MunicipalityIndexEntry[]>;

/** La forma che l'API espone, identica a `MunicipalityCompactSchema`. */
export interface MunicipalityCompact {
	id: string;
	name: string;
	provinceAcronym: string;
}

export interface ResolvedMunicipality {
	/** Il comune, quando è certo. */
	municipality: MunicipalityCompact | null;
	/** Gli omonimi fra cui deve scegliere il cliente, quando non lo è. */
	candidates: MunicipalityCompact[];
}

export function toCompact(entry: MunicipalityIndexEntry): MunicipalityCompact {
	return {
		id: entry.id,
		name: entry.name,
		provinceAcronym: entry.provinceAcronym,
	};
}

export function buildMunicipalityIndex(
	rows: MunicipalityIndexEntry[],
): MunicipalityIndex {
	const index: MunicipalityIndex = new Map();
	for (const row of rows) {
		for (const key of placeNameVariants(row.name)) {
			const bucket = index.get(key);
			if (bucket) bucket.push(row);
			else index.set(key, [row]);
		}
	}
	return index;
}

/** Quanti token significativi condividono la nostra provincia e quella del provider. */
function provinceOverlap(provinceName: string, rawCounty: string): number {
	const ours = new Set(placeTokens(provinceName));
	return placeTokens(rawCounty).filter((token) => ours.has(token)).length;
}

export function resolveMunicipality(
	index: MunicipalityIndex,
	hit: { rawCity: string | null; rawCounty: string | null },
): ResolvedMunicipality {
	if (!hit.rawCity) return { municipality: null, candidates: [] };

	const byId = new Map<string, MunicipalityIndexEntry>();
	for (const variant of placeNameVariants(hit.rawCity)) {
		for (const entry of index.get(variant) ?? []) byId.set(entry.id, entry);
	}
	const matches = [...byId.values()];

	if (matches.length === 0) return { municipality: null, candidates: [] };
	if (matches.length === 1) {
		return { municipality: toCompact(matches[0]), candidates: [] };
	}

	// Omonimi. La provincia del provider è l'unico spareggio disponibile, ed è
	// scritta in modi che non coincidono coi nostri (`Roma Capitale`,
	// `Provincia autonoma di Trento`): conta i token condivisi e pretendi un
	// vincitore netto, altrimenti chiedi al cliente.
	const county = hit.rawCounty;
	if (county) {
		const scored = matches
			.map((entry) => ({
				entry,
				score: provinceOverlap(entry.provinceName, county),
			}))
			.sort((a, b) => b.score - a.score);
		const best = scored[0];
		const runnerUp = scored[1];
		if (best.score > 0 && best.score > (runnerUp?.score ?? 0)) {
			return { municipality: toCompact(best.entry), candidates: [] };
		}
	}

	return { municipality: null, candidates: matches.map(toCompact) };
}

/**
 * Parole che introducono un odonimo. Un nome di comune subito dopo una di
 * queste è una via, non una destinazione: `via roma` non nomina Roma.
 */
const STREET_WORDS = new Set([
	"via",
	"viale",
	"piazza",
	"piazzale",
	"corso",
	"largo",
	"vicolo",
	"strada",
	"stradone",
	"borgo",
	"contrada",
	"lungomare",
	"salita",
	"calle",
	"campo",
	"rotonda",
	"circonvallazione",
	"localita",
	"frazione",
]);

/** Il nome di comune più lungo dell'elenco ISTAT è di 6 parole (4 comuni su 7904, es. "San Casciano in Val di Pesa"). */
const MAX_NAME_WORDS = 6;

/**
 * I comuni nominati nel testo della query. Serve a decidere se affiancare al
 * bias di prossimità una chiamata senza bias: senza questa distinzione, un
 * indirizzo lontano è irraggiungibile, oppure il bias non funziona più.
 */
export function findMunicipalityNamesInQuery(
	index: MunicipalityIndex,
	q: string,
): MunicipalityCompact[] {
	const words = normalizePlaceName(q)
		.split(" ")
		.filter((word) => word.length > 0);
	const found = new Map<string, MunicipalityIndexEntry>();

	for (let i = 0; i < words.length; i++) {
		if (i > 0 && STREET_WORDS.has(words[i - 1])) continue;

		// Dal più lungo al più corto: `reggio nell emilia` prima di `reggio`.
		for (let n = Math.min(MAX_NAME_WORDS, words.length - i); n >= 1; n--) {
			const candidate = words.slice(i, i + n).join(" ");
			const entries = index.get(candidate);
			if (entries) {
				for (const entry of entries) found.set(entry.id, entry);
				break;
			}
		}
	}

	return [...found.values()].map(toCompact);
}
