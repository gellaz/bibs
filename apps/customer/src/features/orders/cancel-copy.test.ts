import { beforeAll, describe, expect, it } from "vitest";
import { overwriteGetLocale } from "@/paraglide/runtime";
import { paidCancelDescription, paidCancelSuccess } from "./cancel-copy";

const fmt = (v: string) => `${v} €`;

describe("cancel copy", () => {
	beforeAll(() => overwriteGetLocale(() => "it"));

	it("restituisce solo i punti quando l'ordine è a 0 €", () => {
		const o = { total: "0.00", pointsSpent: 500 };
		expect(paidCancelDescription(o, fmt)).toBe(
			"Ti restituiamo i tuoi 500 punti.",
		);
		expect(paidCancelSuccess(o)).toBe("Ordine annullato, punti restituiti");
	});

	it("rimborsa la carta e restituisce i punti", () => {
		const o = { total: "4.00", pointsSpent: 500 };
		expect(paidCancelDescription(o, fmt)).toContain("Ti rimborsiamo 4.00 €");
		expect(paidCancelDescription(o, fmt)).toContain(
			"Ti restituiamo anche 500 punti.",
		);
		expect(paidCancelSuccess(o)).toBe("Ordine annullato, rimborso avviato");
	});

	it("senza punti resta il solo rimborso", () => {
		const o = { total: "4.00", pointsSpent: 0 };
		expect(paidCancelDescription(o, fmt)).not.toContain("punti");
	});
});
