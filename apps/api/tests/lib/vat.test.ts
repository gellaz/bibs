import { describe, expect, it } from "bun:test";
import { buildCastelletto, scorporo, VAT_RATES } from "@/lib/vat";

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
