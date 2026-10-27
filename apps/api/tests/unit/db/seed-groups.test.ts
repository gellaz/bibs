import { describe, expect, it } from "bun:test";
import { parseSeedArgs, seedGroups } from "@/db/seed/groups";

describe("seedGroups", () => {
	it("senza filtro semina tutto", () => {
		expect(seedGroups()).toEqual({
			customer: true,
			seller: true,
			orders: true,
		});
	});
	it("--only seleziona un solo gruppo, senza ordini", () => {
		expect(seedGroups("customer")).toEqual({
			customer: true,
			seller: false,
			orders: false,
		});
		expect(seedGroups("seller")).toEqual({
			customer: false,
			seller: true,
			orders: false,
		});
		expect(seedGroups("admin")).toEqual({
			customer: false,
			seller: false,
			orders: false,
		});
	});
});

describe("parseSeedArgs", () => {
	it("legge --only in entrambe le forme", () => {
		expect(parseSeedArgs([])).toBeUndefined();
		expect(parseSeedArgs(["--only=customer"])).toBe("customer");
		expect(parseSeedArgs(["--only", "seller"])).toBe("seller");
	});
	it("rifiuta valori e opzioni sconosciuti col messaggio d'uso", () => {
		expect(() => parseSeedArgs(["--only=sellers"])).toThrow(
			/admin, customer, seller/,
		);
		expect(() => parseSeedArgs(["--onyl=seller"])).toThrow(
			/admin, customer, seller/,
		);
	});
});
