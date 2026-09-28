import { describe, expect, it } from "bun:test";
import { offeredOrderTypes, type StoreOrderType } from "@/lib/order-types";

const both: StoreOrderType[] = ["reserve_pickup", "pay_pickup"];

describe("offeredOrderTypes", () => {
	it("offre la prenotazione configurata dal negozio", () => {
		expect(
			offeredOrderTypes(["reserve_pickup"], { chargesEnabled: false }),
		).toEqual(["reserve_pickup"]);
	});

	it("pay_pickup si offre con incassi abilitati", () => {
		expect(offeredOrderTypes(both, { chargesEnabled: true })).toEqual(both);
		expect(offeredOrderTypes(both, { chargesEnabled: false })).toEqual([
			"reserve_pickup",
		]);
	});

	it("senza incassi abilitati pay_pickup non si offre", () => {
		expect(offeredOrderTypes(both, { chargesEnabled: false })).toEqual([
			"reserve_pickup",
		]);
		expect(
			offeredOrderTypes(["pay_pickup"], { chargesEnabled: false }),
		).toEqual([]);
	});

	it("ignora valori sconosciuti", () => {
		expect(
			offeredOrderTypes(["direct", "reserve_pickup"], {
				chargesEnabled: true,
			}),
		).toEqual(["reserve_pickup"]);
	});
});
