import { describe, expect, it } from "bun:test";
import { orderSummaryCents } from "./order-summary";

const items = [
	{ unitPrice: "3.00", quantity: 1 },
	{ unitPrice: "1.00", quantity: 2 },
];

describe("orderSummaryCents", () => {
	it("senza punti né spedizione il totale è il subtotale", () => {
		expect(
			orderSummaryCents({
				items,
				total: "5.00",
				shippingCost: null,
				pointsSpent: 0,
			}),
		).toEqual({
			subtotal: 500,
			pointsDiscount: 0,
			shipping: 0,
			grandTotal: 500,
		});
	});

	it("con punti lo sconto è subtotale meno totale", () => {
		expect(
			orderSummaryCents({
				items,
				total: "4.00",
				shippingCost: null,
				pointsSpent: 100,
			}),
		).toMatchObject({ pointsDiscount: 100, grandTotal: 400 });
	});

	it("la spedizione non entra nello sconto: `total` è solo merce", () => {
		// 5 € di merce, 1 € di punti, 5 € di spedizione: total = 4,00
		expect(
			orderSummaryCents({
				items,
				total: "4.00",
				shippingCost: "5.00",
				pointsSpent: 100,
			}),
		).toEqual({
			subtotal: 500,
			pointsDiscount: 100,
			shipping: 500,
			grandTotal: 900,
		});
	});
});
