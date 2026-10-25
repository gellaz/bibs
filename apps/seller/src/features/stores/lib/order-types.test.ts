import { describe, expect, it } from "vitest";
import { isToggleLocked, offeredTypes } from "./order-types";

describe("offeredTypes", () => {
	it("senza pagamenti abilitati il cliente non vede Paga e ritira", () => {
		expect(
			offeredTypes(["reserve_pickup", "pay_pickup"], false, false),
		).toEqual(["reserve_pickup"]);
		expect(offeredTypes(["reserve_pickup", "pay_pickup"], true, false)).toEqual(
			["reserve_pickup", "pay_pickup"],
		);
	});

	it("con un cambio di partita IVA in attesa non offre nulla", () => {
		expect(offeredTypes(["reserve_pickup", "pay_pickup"], true, true)).toEqual(
			[],
		);
	});
});

describe("isToggleLocked", () => {
	it("non si spegne l'ultima tipologia che il cliente vede", () => {
		expect(
			isToggleLocked("reserve_pickup", ["reserve_pickup", "pay_pickup"], false),
		).toBe(true);
		expect(
			isToggleLocked("reserve_pickup", ["reserve_pickup", "pay_pickup"], true),
		).toBe(false);
	});

	it("Paga e ritira non si accende senza pagamenti, ma si spegne sempre", () => {
		expect(isToggleLocked("pay_pickup", ["reserve_pickup"], false)).toBe(true);
		expect(isToggleLocked("pay_pickup", ["reserve_pickup"], true)).toBe(false);
		expect(
			isToggleLocked("pay_pickup", ["reserve_pickup", "pay_pickup"], false),
		).toBe(false);
	});
});
