import { describe, expect, it } from "bun:test";
import { platformFeeCents, storePayoutSplit } from "@/lib/platform-fee";

describe("platformFeeCents", () => {
	it("è il 5% del totale, arrotondato al centesimo", () => {
		expect(platformFeeCents(1000)).toBe(50);
		expect(platformFeeCents(1999)).toBe(100); // 99,95 → 100
		expect(platformFeeCents(1990)).toBe(100); // 99,5 → 100 (half-up)
		expect(platformFeeCents(1)).toBe(0);
	});

	it("zero su totale zero", () => {
		expect(platformFeeCents(0)).toBe(0);
	});
});

describe("storePayoutSplit", () => {
	it("senza punti: tutto dal pagamento, totale meno commissione", () => {
		expect(
			storePayoutSplit({
				totalCents: 4000,
				pointsDiscountCents: 0,
				platformFeeCents: 200,
			}),
		).toEqual({ fromCharge: 3800, fromBalance: 0 });
	});

	it("con punti: il negozio riceve il lordo meno commissione, la quota oltre il pagato esce dal saldo bibs", () => {
		// Lordo 12 €, 5 € di punti: il cliente paga 7 €, al negozio 12 − 0,60.
		expect(
			storePayoutSplit({
				totalCents: 700,
				pointsDiscountCents: 500,
				platformFeeCents: 60,
			}),
		).toEqual({ fromCharge: 700, fromBalance: 440 });
	});

	it("punti piccoli: se il pagato copre la quota del negozio, niente dal saldo", () => {
		// Lordo 40 €, 1 € di punti: paga 39 €, al negozio 40 − 2 = 38 €.
		expect(
			storePayoutSplit({
				totalCents: 3900,
				pointsDiscountCents: 100,
				platformFeeCents: 200,
			}),
		).toEqual({ fromCharge: 3800, fromBalance: 0 });
	});

	it("ordine interamente coperto dai punti: tutto dal saldo", () => {
		expect(
			storePayoutSplit({
				totalCents: 0,
				pointsDiscountCents: 500,
				platformFeeCents: 25,
			}),
		).toEqual({ fromCharge: 0, fromBalance: 475 });
	});
});
