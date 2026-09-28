import { describe, expect, it } from "bun:test";
import { formatSignedPoints, signedPoints, toPointRow } from "./point-display";

const base = {
	id: "t1",
	orderId: "11111111-2222-3333-4444-555555555555",
	description: "Earned 12 points from completed order",
	createdAt: "2026-09-25T10:00:00.000Z",
};

describe("signedPoints", () => {
	it("guadagnati e rimborsati entrano, usati escono", () => {
		expect(signedPoints({ type: "earned", amount: 12 })).toBe(12);
		expect(signedPoints({ type: "refunded", amount: 30 })).toBe(30);
		expect(signedPoints({ type: "redeemed", amount: 50 })).toBe(-50);
	});
	it("il segno viene dal tipo anche se l'importo arriva già negativo", () => {
		expect(signedPoints({ type: "redeemed", amount: -50 })).toBe(-50);
		expect(signedPoints({ type: "earned", amount: -12 })).toBe(12);
	});
});

describe("formatSignedPoints", () => {
	it("segno esplicito, meno tipografico", () => {
		expect(formatSignedPoints(12)).toBe("+12");
		expect(formatSignedPoints(-50)).toBe("−50");
		expect(formatSignedPoints(0)).toBe("0");
	});
});

describe("toPointRow", () => {
	it("etichetta per tipo", () => {
		expect(toPointRow({ ...base, type: "earned", amount: 12 }).label).toBe(
			"Guadagnati",
		);
		expect(toPointRow({ ...base, type: "redeemed", amount: 5 }).label).toBe(
			"Usati",
		);
		expect(toPointRow({ ...base, type: "refunded", amount: 5 }).label).toBe(
			"Rimborsati",
		);
	});
	it("i punti usati escono col segno meno", () => {
		const row = toPointRow({ ...base, type: "redeemed", amount: 5 });
		expect(row.points).toBe("−5");
		expect(row.gain).toBe(false);
	});
	it("i punti rimborsati rientrano col segno più", () => {
		const row = toPointRow({ ...base, type: "refunded", amount: 5 });
		expect(row.points).toBe("+5");
		expect(row.gain).toBe(true);
	});
	it("con l'ordine niente descrizione tecnica; senza ordine la descrizione resta", () => {
		expect(toPointRow({ ...base, type: "earned", amount: 12 }).note).toBeNull();
		const manual = toPointRow({
			...base,
			type: "earned",
			amount: 100,
			orderId: null,
			description: "Bonus di benvenuto",
		});
		expect(manual.orderId).toBeNull();
		expect(manual.note).toBe("Bonus di benvenuto");
	});
	it("accetta la data già idratata da Eden", () => {
		const at = new Date("2026-09-25T10:00:00.000Z");
		expect(
			toPointRow({ ...base, type: "earned", amount: 1, createdAt: at })
				.createdAt,
		).toEqual(at);
	});
});
