import { describe, expect, it } from "bun:test";
// Deliberately no API app import: this is the seller form's path, which
// validates the shared schemas on their own, without the API app.
import { DocumentBody, PersonalInfoBody } from "@/lib/schemas/forms";

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
	documentType: "identity_card",
	documentNumber: "CA12345AB",
	documentExpiry: "2030-01-01",
	documentIssuedMunicipalityId: "some-municipality",
};

const IMPOSSIBLE = ["2024-13-45", "2024-02-30", "2023-02-29", "2024-00-10"];
const REAL = ["2024-02-29", "1980-12-31", "2000-02-29"];

describe("calendar dates in the onboarding schemas", () => {
	for (const d of IMPOSSIBLE) {
		it(`rejects ${d}`, () => {
			expect(
				PersonalInfoBody.safeParse({ ...PERSONAL, birthDate: d }).success,
			).toBe(false);
			expect(
				DocumentBody.safeParse({ ...DOCUMENT, documentExpiry: d }).success,
			).toBe(false);
		});
	}

	for (const d of REAL) {
		it(`accepts ${d}`, () => {
			expect(
				PersonalInfoBody.safeParse({ ...PERSONAL, birthDate: d }).success,
			).toBe(true);
			expect(
				DocumentBody.safeParse({ ...DOCUMENT, documentExpiry: d }).success,
			).toBe(true);
		});
	}
});
