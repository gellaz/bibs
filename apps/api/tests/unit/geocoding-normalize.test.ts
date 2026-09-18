import { describe, expect, it } from "bun:test";
import {
	biasCell,
	normalizePlaceName,
	normalizeQuery,
	placeNameVariants,
	placeTokens,
} from "@/lib/geocoding/normalize";

describe("normalizeQuery", () => {
	it("collapses whitespace and lowercases", () => {
		expect(normalizeQuery("  Via  Roma   12 ")).toBe("via roma 12");
	});
});

describe("normalizePlaceName", () => {
	it("strips diacritics", () => {
		expect(normalizePlaceName("Agliè")).toBe("aglie");
	});

	it("turns apostrophes into spaces", () => {
		expect(normalizePlaceName("Sant'Ambrogio di Torino")).toBe(
			"sant ambrogio di torino",
		);
	});

	it("turns hyphens into spaces", () => {
		expect(normalizePlaceName("Pont-Canavese")).toBe("pont canavese");
	});
});

describe("placeNameVariants", () => {
	it("splits a bilingual name written with a spaced hyphen", () => {
		expect(placeNameVariants("Bolzano - Bozen")).toEqual([
			"bolzano bozen",
			"bolzano",
			"bozen",
		]);
	});

	it("splits a bilingual name written with a slash", () => {
		expect(placeNameVariants("Bolzano/Bozen")).toEqual([
			"bolzano bozen",
			"bolzano",
			"bozen",
		]);
	});

	// Un trattino senza spazi non è un bilingue: `Pont-Canavese` non si chiama
	// `Pont`, e indicizzare le metà creerebbe chiavi fantasma.
	it("does NOT split a plain hyphenated name", () => {
		expect(placeNameVariants("Pont-Canavese")).toEqual(["pont canavese"]);
	});
});

describe("placeTokens", () => {
	it("drops filler words so provinces can be compared", () => {
		expect(placeTokens("Monza e della Brianza")).toEqual(["monza", "brianza"]);
	});
});

describe("biasCell", () => {
	it("rounds coordinates into ~1.1km cells", () => {
		expect(biasCell({ lat: 45.4642, lng: 9.19 })).toBe("45.46,9.19");
	});

	it("is a dash when there is no bias", () => {
		expect(biasCell()).toBe("-");
	});
});
