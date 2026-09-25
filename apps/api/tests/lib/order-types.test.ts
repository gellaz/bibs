import { describe, expect, it } from "bun:test";
import {
	ONLINE_PAYMENT_LIVE,
	offeredOrderTypes,
	type StoreOrderType,
} from "@/lib/order-types";

const both: StoreOrderType[] = ["reserve_pickup", "pay_pickup"];

describe("offeredOrderTypes", () => {
	it("offre la prenotazione configurata dal negozio", () => {
		expect(
			offeredOrderTypes(["reserve_pickup"], { chargesEnabled: false }),
		).toEqual(["reserve_pickup"]);
	});

	it("offre pay_pickup solo con incassi abilitati E pagamento online attivo", () => {
		expect(
			offeredOrderTypes(both, { chargesEnabled: true, live: true }),
		).toEqual(both);
		expect(
			offeredOrderTypes(both, { chargesEnabled: false, live: true }),
		).toEqual(["reserve_pickup"]);
		expect(
			offeredOrderTypes(["pay_pickup"], { chargesEnabled: false, live: true }),
		).toEqual([]);
	});

	it("finché la PR F non accende il pagamento, pay_pickup non si offre mai", () => {
		expect(ONLINE_PAYMENT_LIVE).toBe(false);
		expect(offeredOrderTypes(both, { chargesEnabled: true })).toEqual([
			"reserve_pickup",
		]);
	});

	it("ignora valori sconosciuti", () => {
		expect(
			offeredOrderTypes(["direct", "reserve_pickup"], {
				chargesEnabled: true,
				live: true,
			}),
		).toEqual(["reserve_pickup"]);
	});
});
