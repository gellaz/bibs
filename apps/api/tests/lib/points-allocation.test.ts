import { describe, expect, it } from "bun:test";
import { allocateCheckoutPoints } from "@/lib/points-allocation";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("allocateCheckoutPoints", () => {
	it("saldo zero: nessuno sconto", () => {
		expect(allocateCheckoutPoints({ balance: 0, grossCents: [2000] })).toEqual({
			discountCents: [0],
			points: [0],
		});
	});

	it("nessun ordine: liste vuote", () => {
		expect(allocateCheckoutPoints({ balance: 500, grossCents: [] })).toEqual({
			discountCents: [],
			points: [],
		});
	});

	it("saldo che copre tutto: sconto = totale, plafonato", () => {
		const r = allocateCheckoutPoints({ balance: 5000, grossCents: [2000] });
		expect(r).toEqual({ discountCents: [2000], points: [2000] });
	});

	it("saldo parziale con residuo ≥ 0,50 €: usa tutto il saldo", () => {
		const r = allocateCheckoutPoints({ balance: 1000, grossCents: [2000] });
		expect(r).toEqual({ discountCents: [1000], points: [1000] });
	});

	it("residuo tra 0,01 e 0,49 €: usa meno punti e lascia 0,50 €", () => {
		const r = allocateCheckoutPoints({ balance: 1980, grossCents: [2000] });
		expect(r).toEqual({ discountCents: [1950], points: [1950] });
	});

	it("residuo di esattamente 0,50 €: invariato", () => {
		const r = allocateCheckoutPoints({ balance: 1950, grossCents: [2000] });
		expect(r.discountCents).toEqual([1950]);
	});

	it("totale sotto 0,50 € e saldo insufficiente: nessuno sconto", () => {
		const r = allocateCheckoutPoints({ balance: 10, grossCents: [40] });
		expect(r).toEqual({ discountCents: [0], points: [0] });
	});

	it("totale sotto 0,50 € e saldo sufficiente: 0 €", () => {
		const r = allocateCheckoutPoints({ balance: 40, grossCents: [40] });
		expect(r).toEqual({ discountCents: [40], points: [40] });
	});

	it("due negozi: proporzionale al lordo, resti maggiori, somma esatta", () => {
		// 1000 su 2000 + 750: 727,27 → 727 (resto 750), 272,72 → 272 (resto 2000)
		// il centesimo residuo va al resto maggiore (secondo negozio).
		const r = allocateCheckoutPoints({
			balance: 1000,
			grossCents: [2000, 750],
		});
		expect(r.discountCents).toEqual([727, 273]);
		expect(sum(r.discountCents)).toBe(1000);
		expect(r.points).toEqual([727, 273]);
	});

	it("a parità di resto vince il primo, per determinismo", () => {
		const r = allocateCheckoutPoints({
			balance: 101,
			grossCents: [1000, 1000],
		});
		expect(r.discountCents).toEqual([51, 50]);
	});

	it("la regola 0,50 € vale sulla somma, non per negozio", () => {
		// Σ 2750, saldo 2730 → residuo 20 → sconto 2700, ripartito.
		const r = allocateCheckoutPoints({
			balance: 2730,
			grossCents: [2000, 750],
		});
		expect(sum(r.discountCents)).toBe(2700);
		r.discountCents.forEach((d, i) => {
			expect(d).toBeLessThanOrEqual([2000, 750][i]);
		});
	});

	it("nessuna quota supera il lordo del suo ordine", () => {
		for (const balance of [1, 99, 1234, 2749, 2750, 9999]) {
			const gross = [1999, 1, 750];
			const r = allocateCheckoutPoints({ balance, grossCents: gross });
			r.discountCents.forEach((d, i) => {
				expect(d).toBeGreaterThanOrEqual(0);
				expect(d).toBeLessThanOrEqual(gross[i]);
			});
		}
	});
});
