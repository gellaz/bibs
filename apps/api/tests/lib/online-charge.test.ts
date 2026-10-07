import { describe, expect, it } from "bun:test";
import { isBelowOnlineMinimum } from "@/lib/online-charge";

describe("isBelowOnlineMinimum", () => {
	it("0 €: niente da incassare, permesso", () => {
		expect(isBelowOnlineMinimum(0)).toBe(false);
	});
	it("tra 0,01 e 0,49 €: Stripe lo rifiuterebbe", () => {
		expect(isBelowOnlineMinimum(1)).toBe(true);
		expect(isBelowOnlineMinimum(49)).toBe(true);
	});
	it("0,50 € e oltre: permesso", () => {
		expect(isBelowOnlineMinimum(50)).toBe(false);
		expect(isBelowOnlineMinimum(51)).toBe(false);
	});
});
