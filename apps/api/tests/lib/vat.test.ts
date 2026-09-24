import { describe, expect, it } from "bun:test";
import {
	apportionDiscount,
	buildCastelletto,
	scorporo,
	VAT_RATES,
} from "@/lib/vat";

describe("VAT_RATES", () => {
	it("lists the five Italian rates as strings, default-first", () => {
		expect(VAT_RATES).toEqual(["22", "10", "5", "4", "0"]);
	});
});

describe("scorporo", () => {
	it("splits a gross cents amount into net + vat (22%)", () => {
		// 12.20 € gross @ 22% → 10.00 net + 2.20 vat
		expect(scorporo(1220, 22)).toEqual({ netCents: 1000, vatCents: 220 });
	});

	it("splits 10% cleanly", () => {
		// 11.00 € gross @ 10% → 10.00 net + 1.00 vat
		expect(scorporo(1100, 10)).toEqual({ netCents: 1000, vatCents: 100 });
	});

	it("rounds half-up on the net, vat is the remainder so net+vat == gross", () => {
		// 10.00 € gross @ 22% → net 8.1967 → 820 cents; vat = 1000-820 = 180
		expect(scorporo(1000, 22)).toEqual({ netCents: 820, vatCents: 180 });
		// 0.99 € gross @ 22% → net round(81.147) = 81; vat = 18
		expect(scorporo(99, 22)).toEqual({ netCents: 81, vatCents: 18 });
	});

	it("treats 0% as all-net, zero vat", () => {
		expect(scorporo(1599, 0)).toEqual({ netCents: 1599, vatCents: 0 });
	});

	it("handles a zero amount", () => {
		expect(scorporo(0, 22)).toEqual({ netCents: 0, vatCents: 0 });
	});
});

describe("buildCastelletto", () => {
	it("groups gross by rate and scorpora per rate, sorted rate-desc", () => {
		const result = buildCastelletto([
			{ grossCents: 1220, rate: 22 },
			{ grossCents: 1100, rate: 10 },
			{ grossCents: 1220, rate: 22 }, // same rate as the first → aggregated
		]);
		expect(result).toEqual([
			{ rate: 22, taxableAmount: "20.00", taxAmount: "4.40" },
			{ rate: 10, taxableAmount: "10.00", taxAmount: "1.00" },
		]);
	});

	it("scorpora on the per-rate aggregate (not per line)", () => {
		// Two 10.00 lines @ 22% aggregate to 2000 → net round(1639.34)=1639, vat=361.
		// (Per-line would give 820+820=1640/180+180=360 — the aggregate is authoritative.)
		const result = buildCastelletto([
			{ grossCents: 1000, rate: 22 },
			{ grossCents: 1000, rate: 22 },
		]);
		expect(result).toEqual([
			{ rate: 22, taxableAmount: "16.39", taxAmount: "3.61" },
		]);
	});

	it("returns an empty array for no lines", () => {
		expect(buildCastelletto([])).toEqual([]);
	});
});

describe("apportionDiscount", () => {
	it("con sconto zero restituisce il lordo aggregato per aliquota", () => {
		expect(
			apportionDiscount(
				[
					{ grossCents: 1100, rate: 10 },
					{ grossCents: 1220, rate: 22 },
				],
				0,
			),
		).toEqual([
			{ rate: 22, grossCents: 1220 },
			{ rate: 10, grossCents: 1100 },
		]);
	});

	it("aggrega le righe con la stessa aliquota prima di ripartire", () => {
		expect(
			apportionDiscount(
				[
					{ grossCents: 500, rate: 22 },
					{ grossCents: 500, rate: 22 },
				],
				100,
			),
		).toEqual([{ rate: 22, grossCents: 900 }]);
	});

	it("ripartisce in proporzione al lordo di ciascuna aliquota", () => {
		// 2,32 € su 23,20 €: 1,22 alla 22% (1220/2320), 1,10 alla 10%
		expect(
			apportionDiscount(
				[
					{ grossCents: 1220, rate: 22 },
					{ grossCents: 1100, rate: 10 },
				],
				232,
			),
		).toEqual([
			{ rate: 22, grossCents: 1098 },
			{ rate: 10, grossCents: 990 },
		]);
	});

	it("assegna i centesimi residui coi resti maggiori, a parità all'aliquota più alta", () => {
		// 100 su tre quote uguali: 33 ciascuna + 1 residuo → alla 22%
		expect(
			apportionDiscount(
				[
					{ grossCents: 100, rate: 4 },
					{ grossCents: 100, rate: 22 },
					{ grossCents: 100, rate: 10 },
				],
				100,
			),
		).toEqual([
			{ rate: 22, grossCents: 66 },
			{ rate: 10, grossCents: 67 },
			{ rate: 4, grossCents: 67 },
		]);
	});

	it("a parità esatta di resto vince l'aliquota più alta anche con quote diverse", () => {
		// 3 su 1 (22%) + 1 (10%) + 7 (4%): quote 1/3, 1/3, 7/3 → resti tutti 1/3.
		// In virgola mobile il resto della 4% esce 0,3333…35 e ruberebbe il
		// centesimo: il confronto va fatto sui resti interi.
		expect(
			apportionDiscount(
				[
					{ grossCents: 1, rate: 22 },
					{ grossCents: 1, rate: 10 },
					{ grossCents: 7, rate: 4 },
				],
				3,
			),
		).toEqual([
			{ rate: 22, grossCents: 0 },
			{ rate: 10, grossCents: 1 },
			{ rate: 4, grossCents: 5 },
		]);
	});

	it("il resto maggiore vince sull'aliquota", () => {
		// 10 su 700 (22%) + 300 (10%): quote 7,0 e 3,0 → nessun residuo;
		// 11 su 700 + 300: quote 7,7 e 3,3 → base 7+3, residuo 1 alla 22% (0,7 > 0,3)
		expect(
			apportionDiscount(
				[
					{ grossCents: 300, rate: 10 },
					{ grossCents: 700, rate: 22 },
				],
				11,
			),
		).toEqual([
			{ rate: 22, grossCents: 692 },
			{ rate: 10, grossCents: 297 },
		]);
		// 13 su 700 + 300: quote 9,1 e 3,9 → residuo alla 10% (0,9 > 0,1)
		expect(
			apportionDiscount(
				[
					{ grossCents: 700, rate: 22 },
					{ grossCents: 300, rate: 10 },
				],
				13,
			),
		).toEqual([
			{ rate: 22, grossCents: 691 },
			{ rate: 10, grossCents: 296 },
		]);
	});

	it("con sconto pari al totale azzera ogni aliquota", () => {
		expect(
			apportionDiscount(
				[
					{ grossCents: 1220, rate: 22 },
					{ grossCents: 1100, rate: 10 },
				],
				2320,
			),
		).toEqual([
			{ rate: 22, grossCents: 0 },
			{ rate: 10, grossCents: 0 },
		]);
	});

	it("conserva sempre il totale scontato e non va mai sotto zero", () => {
		const lines = [
			{ grossCents: 1999, rate: 22 },
			{ grossCents: 347, rate: 10 },
			{ grossCents: 58, rate: 5 },
			{ grossCents: 1, rate: 4 },
		];
		const gross = lines.reduce((s, l) => s + l.grossCents, 0);
		for (let d = 0; d <= gross; d += 7) {
			const out = apportionDiscount(lines, d);
			expect(out.reduce((s, l) => s + l.grossCents, 0)).toBe(gross - d);
			for (const l of out) expect(l.grossCents).toBeGreaterThanOrEqual(0);
		}
	});

	it("rifiuta uno sconto negativo o superiore al lordo", () => {
		const lines = [{ grossCents: 100, rate: 22 }];
		expect(() => apportionDiscount(lines, -1)).toThrow(RangeError);
		expect(() => apportionDiscount(lines, 101)).toThrow(RangeError);
	});
});
