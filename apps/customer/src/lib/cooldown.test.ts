import { describe, expect, test } from "bun:test";
import {
	cooldownState,
	msUntilNextSecond,
	sentAtFromSearch,
} from "@bibs/ui/hooks/use-cooldown";

describe("cooldownState", () => {
	test("senza partenza è pronto", () => {
		expect(cooldownState(null, 60_000, 1_000)).toEqual({
			remaining: 0,
			secondsRemaining: 0,
			ready: true,
		});
	});

	test("i secondi si arrotondano per eccesso", () => {
		expect(cooldownState(0, 60_000, 1)).toMatchObject({
			remaining: 59_999,
			secondsRemaining: 60,
			ready: false,
		});
		expect(cooldownState(0, 60_000, 59_001).secondsRemaining).toBe(1);
	});

	test("scaduto resta a zero", () => {
		expect(cooldownState(0, 60_000, 90_000)).toMatchObject({
			remaining: 0,
			ready: true,
		});
	});
});

describe("msUntilNextSecond", () => {
	test("aspetta fino al prossimo cambio del secondo mostrato", () => {
		// 59.250 s rimasti: si mostra 60, il 59 arriva fra 250 ms.
		expect(msUntilNextSecond(59_250)).toBe(250);
	});

	test("sul confine esatto aspetta un secondo pieno", () => {
		expect(msUntilNextSecond(59_000)).toBe(1_000);
	});
});

describe("sentAtFromSearch", () => {
	const now = 1_000_000;

	test("senza invio reale il cooldown non parte", () => {
		expect(sentAtFromSearch(undefined, now)).toBeNull();
	});

	test("un invio passato vale com'è (anche dopo un refresh)", () => {
		expect(sentAtFromSearch(now - 20_000, now)).toBe(now - 20_000);
	});

	test("un istante futuro (orologio sfasato o URL ritoccato) vale adesso", () => {
		expect(sentAtFromSearch(now + 3_600_000, now)).toBe(now);
	});
});
