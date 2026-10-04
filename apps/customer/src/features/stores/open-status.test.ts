import { Clock, HelpCircle } from "lucide-react";
import { describe, expect, it } from "vitest";
import { openStatusIcon, openStatusLabel } from "./open-status";

describe("openStatusLabel", () => {
	it("says the hours are missing, never «Chiuso», when the status is unknown", () => {
		expect(openStatusLabel({ isOpen: false, status: "unknown" })).toBe(
			"Orari non indicati",
		);
	});

	it("still says «Chiuso» for a store we know is closed", () => {
		expect(openStatusLabel({ isOpen: false, status: "closed" })).toBe("Chiuso");
	});

	it("keeps the reopening detail when we have one", () => {
		const label = openStatusLabel({
			isOpen: false,
			status: "closed",
			opensAt: { date: "2999-01-01", time: "08:30" },
		});
		expect(label).toMatch(/^Chiuso · apre /);
		expect(label).toContain("08:30");
	});

	it("is unaffected for an open store", () => {
		expect(
			openStatusLabel({ isOpen: true, status: "open", closesAt: "19:30" }),
		).toBe("Aperto · chiude alle 19:30");
	});
});

describe("openStatusIcon", () => {
	it("uses the question mark only when the hours are unknown", () => {
		expect(openStatusIcon({ isOpen: false, status: "unknown" })).toBe(
			HelpCircle,
		);
		expect(openStatusIcon({ isOpen: false, status: "closed" })).toBe(Clock);
		expect(openStatusIcon({ isOpen: true, status: "open" })).toBe(Clock);
	});
});
