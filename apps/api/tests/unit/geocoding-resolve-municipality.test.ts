import { describe, expect, it } from "bun:test";
import {
	buildMunicipalityIndex,
	type MunicipalityIndexEntry,
	resolveMunicipality,
} from "@/lib/geocoding/resolve-municipality";

const ROWS: MunicipalityIndexEntry[] = [
	{
		id: "m-pioltello",
		name: "Pioltello",
		provinceAcronym: "MI",
		provinceName: "Milano",
	},
	{
		id: "m-bolzano",
		name: "Bolzano",
		provinceAcronym: "BZ",
		provinceName: "Bolzano/Bozen",
	},
	{
		id: "m-aglie",
		name: "Agliè",
		provinceAcronym: "TO",
		provinceName: "Torino",
	},
	{ id: "m-roma", name: "Roma", provinceAcronym: "RM", provinceName: "Roma" },
	// I due omonimi reali su cui si gioca lo spareggio per provincia.
	{
		id: "m-castro-bg",
		name: "Castro",
		provinceAcronym: "BG",
		provinceName: "Bergamo",
	},
	{
		id: "m-castro-le",
		name: "Castro",
		provinceAcronym: "LE",
		provinceName: "Lecce",
	},
	{
		id: "m-livo-co",
		name: "Livo",
		provinceAcronym: "CO",
		provinceName: "Como",
	},
	{
		id: "m-livo-tn",
		name: "Livo",
		provinceAcronym: "TN",
		provinceName: "Trento",
	},
];

const index = buildMunicipalityIndex(ROWS);

describe("resolveMunicipality", () => {
	it("resolves a unique name", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Pioltello",
			rawCounty: "Milano",
		});
		expect(result.municipality).toEqual({
			id: "m-pioltello",
			name: "Pioltello",
			provinceAcronym: "MI",
		});
		expect(result.candidates).toEqual([]);
	});

	// Photon scrive i comuni altoatesini bilingui, il nostro seed no.
	it("resolves a bilingual city name", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Bolzano - Bozen",
			rawCounty: "Bolzano - Bozen",
		});
		expect(result.municipality?.id).toBe("m-bolzano");
	});

	it("resolves a name with diacritics", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Agliè",
			rawCounty: "Torino",
		});
		expect(result.municipality?.id).toBe("m-aglie");
	});

	// Il `county` del provider è rumoroso: `Roma Capitale` per la nostra `Roma`.
	it("resolves a unique name even when the province name is noisy", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Roma",
			rawCounty: "Roma Capitale",
		});
		expect(result.municipality?.id).toBe("m-roma");
	});

	it("breaks a homonym tie using the province", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Castro",
			rawCounty: "Lecce",
		});
		expect(result.municipality?.id).toBe("m-castro-le");
		expect(result.candidates).toEqual([]);
	});

	it("breaks a homonym tie on shared province tokens", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Livo",
			rawCounty: "Provincia autonoma di Trento",
		});
		expect(result.municipality?.id).toBe("m-livo-tn");
	});

	it("returns candidates when a homonym cannot be disambiguated", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Castro",
			rawCounty: null,
		});
		expect(result.municipality).toBeNull();
		expect(result.candidates.map((c) => c.id).sort()).toEqual([
			"m-castro-bg",
			"m-castro-le",
		]);
	});

	it("returns candidates when the province matches nothing", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Castro",
			rawCounty: "Provincia Inesistente",
		});
		expect(result.municipality).toBeNull();
		expect(result.candidates).toHaveLength(2);
	});

	it("returns nothing for an unknown city", () => {
		const result = resolveMunicipality(index, {
			rawCity: "Nonesiste",
			rawCounty: "Milano",
		});
		expect(result.municipality).toBeNull();
		expect(result.candidates).toEqual([]);
	});

	it("returns nothing when the provider gave no city", () => {
		const result = resolveMunicipality(index, {
			rawCity: null,
			rawCounty: "Milano",
		});
		expect(result.municipality).toBeNull();
		expect(result.candidates).toEqual([]);
	});
});
