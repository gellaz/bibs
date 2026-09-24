import { describe, expect, it } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
// Deliberately no Elysia import: this is the seller form's path, which compiles
// the shared schemas with TypeCompiler and never loads Elysia's formats.
import { DocumentBody, PersonalInfoBody } from "@/lib/schemas/forms";

const personal = TypeCompiler.Compile(PersonalInfoBody);
const document = TypeCompiler.Compile(DocumentBody);

const PERSONAL = {
	firstName: "Mario",
	lastName: "Rossi",
	citizenship: "IT",
	birthCountry: "IT",
	birthDate: "1980-01-01",
	residenceCountry: "IT",
	residenceMunicipalityId: "some-municipality",
	residenceAddress: "Via Roma 1",
	residenceZipCode: "00100",
};

const DOCUMENT = {
	documentNumber: "CA12345",
	documentExpiry: "2030-01-01",
	documentIssuedMunicipalityId: "some-municipality",
};

const IMPOSSIBLE = ["2024-13-45", "2024-02-30", "2023-02-29", "2024-00-10"];
const REAL = ["2024-02-29", "1980-12-31", "2000-02-29"];

describe("calendar dates in the onboarding schemas", () => {
	for (const d of IMPOSSIBLE) {
		it(`rejects ${d}`, () => {
			expect(personal.Check({ ...PERSONAL, birthDate: d })).toBe(false);
			expect(document.Check({ ...DOCUMENT, documentExpiry: d })).toBe(false);
		});
	}

	for (const d of REAL) {
		it(`accepts ${d}`, () => {
			expect(personal.Check({ ...PERSONAL, birthDate: d })).toBe(true);
			expect(document.Check({ ...DOCUMENT, documentExpiry: d })).toBe(true);
		});
	}
});
