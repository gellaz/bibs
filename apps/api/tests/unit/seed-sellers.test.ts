import { describe, expect, it } from "bun:test";
import { generateSellersSeedData } from "@/db/seed/fixtures/sellers";
import { isValidDocumentNumber } from "@/lib/schemas/forms/identity-document";

describe("generateSellersSeedData", () => {
	const data = generateSellersSeedData();

	it("segue il flusso di onboarding vero", () => {
		expect(data).toHaveLength(190);
		const withOrg = new Set(["pending_review", "active", "rejected"]);
		for (const s of data) {
			expect(s.org !== null).toBe(withOrg.has(s.onboardingStatus));
			expect(s.emailVerified).toBe(s.onboardingStatus !== "pending_email");
			if (
				s.onboardingStatus === "pending_email" ||
				s.onboardingStatus === "pending_personal"
			)
				expect(s.name).toBe(s.email.split("@")[0]);
		}
	});

	it("documenti validi, unici, con foto e tutti i tipi", () => {
		for (const s of data) {
			const { documentType, documentNumber, documentImage } = s.profileFields;
			expect(documentImage !== null).toBe(documentType !== null);
			if (documentType)
				expect(isValidDocumentNumber(documentType, documentNumber!)).toBe(true);
		}
		const numbers = data
			.map((s) => s.profileFields.documentNumber)
			.filter(Boolean);
		expect(new Set(numbers).size).toBe(numbers.length);
		const types = new Set(
			data.map((s) => s.profileFields.documentType).filter(Boolean),
		);
		expect(types).toEqual(
			new Set(["identity_card", "driving_license", "passport"]),
		);
		// CIE elettronica presente, non solo la cartacea
		expect(
			data.some(
				(s) =>
					s.profileFields.documentType === "identity_card" &&
					/^[A-Z]{2}\d{5}[A-Z]{2}$/.test(s.profileFields.documentNumber!),
			),
		).toBe(true);
	});
});
