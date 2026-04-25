/**
 * Fetches Italian administrative divisions from the comuni-json GitHub repo
 * and generates regions.json, provinces.json, municipalities.json.
 *
 * Usage: bun run src/db/seed/base/fetch-locations.ts
 */

const COMUNI_JSON_URL =
	"https://raw.githubusercontent.com/matteocontrini/comuni-json/master/comuni.json";

interface Comune {
	nome: string;
	codice: string;
	regione: { codice: string; nome: string };
	provincia: { codice: string; nome: string };
	sigla: string;
}

interface Region {
	name: string;
	istatCode: string;
}

interface Province {
	name: string;
	acronym: string;
	istatCode: string;
	regionIstatCode: string;
}

interface Municipality {
	name: string;
	istatCode: string;
	provinceIstatCode: string;
}

async function generate() {
	console.log("📥 Fetching comuni-json data...");
	const response = await fetch(COMUNI_JSON_URL);
	if (!response.ok) {
		throw new Error(`Failed to fetch: ${response.status}`);
	}

	const comuni: Comune[] = await response.json();
	console.log(`   ${comuni.length} comuni fetched`);

	// Extract unique regions
	const regionsMap = new Map<string, Region>();
	for (const c of comuni) {
		if (!regionsMap.has(c.regione.codice)) {
			regionsMap.set(c.regione.codice, {
				name: c.regione.nome,
				istatCode: c.regione.codice,
			});
		}
	}

	// Extract unique provinces
	const provincesMap = new Map<string, Province>();
	for (const c of comuni) {
		if (!provincesMap.has(c.provincia.codice)) {
			provincesMap.set(c.provincia.codice, {
				name: c.provincia.nome,
				acronym: c.sigla,
				istatCode: c.provincia.codice,
				regionIstatCode: c.regione.codice,
			});
		}
	}

	// Map municipalities
	const municipalities: Municipality[] = comuni.map((c) => ({
		name: c.nome,
		istatCode: c.codice,
		provinceIstatCode: c.provincia.codice,
	}));

	const regions = [...regionsMap.values()].sort((a, b) =>
		a.istatCode.localeCompare(b.istatCode),
	);
	const provinces = [...provincesMap.values()].sort((a, b) =>
		a.istatCode.localeCompare(b.istatCode),
	);
	municipalities.sort((a, b) => a.istatCode.localeCompare(b.istatCode));

	const dir = import.meta.dirname;
	await Bun.write(`${dir}/regions.json`, JSON.stringify(regions, null, 2));
	await Bun.write(`${dir}/provinces.json`, JSON.stringify(provinces, null, 2));
	await Bun.write(
		`${dir}/municipalities.json`,
		JSON.stringify(municipalities, null, 2),
	);

	console.log(`✅ Generated:`);
	console.log(`   ${regions.length} regions`);
	console.log(`   ${provinces.length} provinces`);
	console.log(`   ${municipalities.length} municipalities`);
}

generate().catch(console.error);
