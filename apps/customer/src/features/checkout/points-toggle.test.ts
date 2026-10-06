import { beforeEach, describe, expect, it } from "vitest";
import { overwriteGetLocale } from "@/paraglide/runtime";
import {
	amountDueOnline,
	formatPoints,
	pointsToggleLabel,
} from "./points-toggle";

beforeEach(() => overwriteGetLocale(() => "it"));

describe("formatPoints", () => {
	it("separatore delle migliaia della lingua", () => {
		expect(formatPoints(1240)).toBe("1.240");
	});
});

describe("pointsToggleLabel", () => {
	it("usa tutto il saldo", () => {
		expect(
			pointsToggleLabel({ pointsSpent: 1240, discount: "12.40" }, 1240),
		).toBe("Usa 1.240 punti");
	});
	it("ne usa meno del saldo (plafond o regola 0,50 €)", () => {
		expect(
			pointsToggleLabel({ pointsSpent: 1190, discount: "11.90" }, 1240),
		).toBe("Usa 1.190 dei tuoi 1.240 punti");
	});
});

describe("amountDueOnline", () => {
	const preview = {
		withoutPoints: { amountDueOnline: "24.80" },
		withPoints: { amountDueOnline: "12.40" },
	};
	it("spento: senza punti", () => {
		expect(amountDueOnline(preview, false)).toBe("24.80");
	});
	it("acceso: con punti", () => {
		expect(amountDueOnline(preview, true)).toBe("12.40");
	});
	it("acceso ma withPoints null: senza punti", () => {
		expect(amountDueOnline({ ...preview, withPoints: null }, true)).toBe(
			"24.80",
		);
	});
});
