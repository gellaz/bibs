import { describe, expect, it } from "bun:test";
import {
	DOCUMENT_NUMBER_EXAMPLES,
	IDENTITY_DOCUMENT_TYPES,
	type IdentityDocumentType,
	isDocumentExpired,
	isValidDocumentNumber,
	normalizeDocumentNumber,
	todayInRome,
} from "@/schemas/forms/identity-document";

describe("normalizeDocumentNumber", () => {
	it("porta in maiuscolo e tiene solo lettere e cifre", () => {
		expect(normalizeDocumentNumber(" ca 12345-ab. ")).toBe("CA12345AB");
	});
});

describe("isValidDocumentNumber", () => {
	const cases: [IdentityDocumentType, string, boolean][] = [
		["identity_card", "CA12345AB", true],
		["identity_card", "AX1234567", true],
		["identity_card", "CA1234AB", false],
		["identity_card", "U1T86I309C", false],
		["driving_license", "U1T86I309C", true],
		["driving_license", "MI1234567A", true],
		["driving_license", "U1T86I309", false],
		["driving_license", "CA12345AB", false],
		["passport", "YA1234567", true],
		["passport", "YA123456", false],
		["passport", "U1T86I309C", false],
	];
	for (const [type, number, valid] of cases) {
		it(`${type} ${number} → ${valid}`, () => {
			expect(isValidDocumentNumber(type, number)).toBe(valid);
		});
	}

	it("ogni esempio è valido per il suo tipo", () => {
		for (const type of IDENTITY_DOCUMENT_TYPES) {
			expect(isValidDocumentNumber(type, DOCUMENT_NUMBER_EXAMPLES[type])).toBe(
				true,
			);
		}
	});
});

describe("isDocumentExpired", () => {
	it("ieri è scaduto", () => {
		expect(isDocumentExpired("2026-10-12", "2026-10-13")).toBe(true);
	});
	it("oggi è ancora valido", () => {
		expect(isDocumentExpired("2026-10-13", "2026-10-13")).toBe(false);
	});
	it("domani è valido", () => {
		expect(isDocumentExpired("2026-10-14", "2026-10-13")).toBe(false);
	});
	it("confronta anche a cavallo d'anno", () => {
		expect(isDocumentExpired("2025-12-31", "2026-01-01")).toBe(true);
	});
});

describe("todayInRome", () => {
	it("formatta AAAA-MM-GG", () => {
		expect(todayInRome(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
	});
	it("usa il giorno di Roma, non quello UTC", () => {
		// 22:30 UTC del 13/10 = 00:30 del 14/10 a Roma (CEST, UTC+2).
		expect(todayInRome(new Date("2026-10-13T22:30:00Z"))).toBe("2026-10-14");
	});
});
