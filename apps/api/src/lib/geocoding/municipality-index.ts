import { db } from "@/db";
import {
	buildMunicipalityIndex,
	type MunicipalityIndex,
} from "./resolve-municipality";

let cached: MunicipalityIndex | null = null;
let loading: Promise<MunicipalityIndex> | null = null;

/**
 * I comuni italiani non cambiano durante la vita di un processo: l'indice si
 * costruisce una volta sola. Stesso principio di `/municipalities/all`, che è
 * cacheato 24 h lato HTTP.
 */
export async function loadMunicipalityIndex(): Promise<MunicipalityIndex> {
	if (cached) return cached;
	if (!loading) {
		loading = (async () => {
			const rows = await db.query.municipality.findMany({
				columns: { id: true, name: true },
				with: { province: { columns: { acronym: true, name: true } } },
			});
			const index = buildMunicipalityIndex(
				rows.map((row) => ({
					id: row.id,
					name: row.name,
					provinceAcronym: row.province.acronym,
					provinceName: row.province.name,
				})),
			);
			cached = index;
			loading = null;
			return index;
		})();
	}
	return loading;
}

/** Test-only: svuota l'indice memoizzato fra i casi. */
export function resetMunicipalityIndex(): void {
	cached = null;
	loading = null;
}
