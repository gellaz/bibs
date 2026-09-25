import { describe, expect, it } from "bun:test";
import { offeredOrderTypes } from "@/lib/order-types";

describe("offeredOrderTypes", () => {
	it("offre la prenotazione configurata dal negozio", () => {
		expect(offeredOrderTypes(["reserve_pickup"])).toEqual(["reserve_pickup"]);
	});

	it("non offre il pagamento online finché non c'è l'incasso (PR E/F)", () => {
		expect(offeredOrderTypes(["reserve_pickup", "pay_pickup"])).toEqual([
			"reserve_pickup",
		]);
		expect(offeredOrderTypes(["pay_pickup"])).toEqual([]);
	});

	it("ignora valori sconosciuti", () => {
		expect(offeredOrderTypes(["direct", "reserve_pickup"])).toEqual([
			"reserve_pickup",
		]);
	});
});
