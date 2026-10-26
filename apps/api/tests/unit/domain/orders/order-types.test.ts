import { describe, expect, it } from "bun:test";
import {
	offeredOrderTypes,
	type StoreOrderType,
} from "@/domain/orders/order-types";

const both: StoreOrderType[] = ["reserve_pickup", "pay_pickup"];

describe("offeredOrderTypes", () => {
	it("offre la prenotazione configurata dal negozio", () => {
		expect(
			offeredOrderTypes(["reserve_pickup"], {
				chargesEnabled: false,
				vatChangeBlocked: false,
			}),
		).toEqual(["reserve_pickup"]);
	});

	it("pay_pickup si offre con incassi abilitati", () => {
		expect(
			offeredOrderTypes(both, {
				chargesEnabled: true,
				vatChangeBlocked: false,
			}),
		).toEqual(both);
		expect(
			offeredOrderTypes(both, {
				chargesEnabled: false,
				vatChangeBlocked: false,
			}),
		).toEqual(["reserve_pickup"]);
	});

	it("senza incassi abilitati pay_pickup non si offre", () => {
		expect(
			offeredOrderTypes(both, {
				chargesEnabled: false,
				vatChangeBlocked: false,
			}),
		).toEqual(["reserve_pickup"]);
		expect(
			offeredOrderTypes(["pay_pickup"], {
				chargesEnabled: false,
				vatChangeBlocked: false,
			}),
		).toEqual([]);
	});

	it("ignora valori sconosciuti", () => {
		expect(
			offeredOrderTypes(["direct", "reserve_pickup"], {
				chargesEnabled: true,
				vatChangeBlocked: false,
			}),
		).toEqual(["reserve_pickup"]);
	});

	it("con un cambio partita IVA in attesa non offre niente", () => {
		expect(
			offeredOrderTypes(both, { chargesEnabled: true, vatChangeBlocked: true }),
		).toEqual([]);
	});
});
