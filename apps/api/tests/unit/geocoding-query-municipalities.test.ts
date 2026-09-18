import { describe, expect, it } from "bun:test";
import {
	buildMunicipalityIndex,
	findMunicipalityNamesInQuery,
	type MunicipalityIndexEntry,
} from "@/lib/geocoding/resolve-municipality";

const ROWS: MunicipalityIndexEntry[] = [
	{ id: "m-roma", name: "Roma", provinceAcronym: "RM", provinceName: "Roma" },
	{
		id: "m-palermo",
		name: "Palermo",
		provinceAcronym: "PA",
		provinceName: "Palermo",
	},
	{
		id: "m-milano",
		name: "Milano",
		provinceAcronym: "MI",
		provinceName: "Milano",
	},
	{
		id: "m-reggio",
		name: "Reggio nell'Emilia",
		provinceAcronym: "RE",
		provinceName: "Reggio nell'Emilia",
	},
];

const index = buildMunicipalityIndex(ROWS);

describe("findMunicipalityNamesInQuery", () => {
	// Il caso che protegge il bias: qui Roma è una via, non una destinazione.
	it("ignores a municipality name used as a street name", () => {
		expect(findMunicipalityNamesInQuery(index, "via roma 12")).toEqual([]);
	});

	it("ignores it after any street word", () => {
		expect(findMunicipalityNamesInQuery(index, "corso palermo 5")).toEqual([]);
		expect(findMunicipalityNamesInQuery(index, "piazza milano 3")).toEqual([]);
	});

	it("finds a municipality named after the street", () => {
		expect(
			findMunicipalityNamesInQuery(index, "via roma 12 palermo").map(
				(m) => m.id,
			),
		).toEqual(["m-palermo"]);
	});

	it("finds a municipality at the start of the query", () => {
		expect(
			findMunicipalityNamesInQuery(index, "milano via roma 12").map(
				(m) => m.id,
			),
		).toEqual(["m-milano"]);
	});

	it("matches multi-word names", () => {
		expect(
			findMunicipalityNamesInQuery(
				index,
				"via emilia 4 reggio nell'emilia",
			).map((m) => m.id),
		).toEqual(["m-reggio"]);
	});

	it("returns an empty list when no municipality is named", () => {
		expect(findMunicipalityNamesInQuery(index, "via garibaldi 7")).toEqual([]);
	});
});
