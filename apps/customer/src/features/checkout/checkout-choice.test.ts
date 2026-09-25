import { describe, expect, it } from "bun:test";
import {
	checkoutFailure,
	confirmLabel,
	parseChoice,
	resolveChoice,
	serializeChoice,
} from "./checkout-choice";

describe("parse/serializeChoice", () => {
	it("fa il giro completo", () => {
		const c = { s1: "reserve_pickup", s2: "pay_pickup" } as const;
		expect(parseChoice(serializeChoice(c))).toEqual(c);
	});
	it("scarta valori malformati o tipi sconosciuti", () => {
		expect(parseChoice("s1:reserve_pickup,s2:direct,broken,:x")).toEqual({
			s1: "reserve_pickup",
		});
		expect(parseChoice(undefined)).toEqual({});
		expect(parseChoice(42)).toEqual({});
	});
	it("una scelta vuota non va in URL", () => {
		expect(serializeChoice({})).toBeUndefined();
	});
});

describe("resolveChoice", () => {
	const groups = [
		{ store: { id: "s1", orderTypes: ["reserve_pickup" as const] } },
		{
			store: {
				id: "s2",
				orderTypes: ["reserve_pickup" as const, "pay_pickup" as const],
			},
		},
	];
	it("preseleziona l'unico tipo offerto", () => {
		expect(resolveChoice(groups, {})).toEqual({
			choice: { s1: "reserve_pickup" },
			complete: false,
		});
	});
	it("è completa quando ogni negozio ha un tipo offerto", () => {
		expect(resolveChoice(groups, { s2: "pay_pickup" })).toEqual({
			choice: { s1: "reserve_pickup", s2: "pay_pickup" },
			complete: true,
		});
	});
	it("scarta un tipo non offerto e i negozi non più nel carrello", () => {
		expect(
			resolveChoice(groups, { s1: "pay_pickup", gone: "reserve_pickup" }),
		).toEqual({ choice: { s1: "reserve_pickup" }, complete: false });
	});
});

describe("confirmLabel", () => {
	it("dice cosa succede", () => {
		expect(confirmLabel(["reserve_pickup"])).toBe("Prenota");
		expect(confirmLabel(["pay_pickup", "pay_pickup"])).toBe("Paga");
		expect(confirmLabel(["reserve_pickup", "pay_pickup"])).toBe(
			"Prenota e paga",
		);
	});
});

describe("checkoutFailure", () => {
	it("carrello cambiato o scelta non valida: si torna al carrello", () => {
		expect(checkoutFailure(409)).toBe("back_to_cart");
		expect(checkoutFailure(400)).toBe("back_to_cart");
		expect(checkoutFailure(422)).toBe("back_to_cart");
	});
	it("rete o server: si resta e si riprova con la stessa chiave", () => {
		expect(checkoutFailure(undefined)).toBe("retry");
		expect(checkoutFailure(500)).toBe("retry");
		expect(checkoutFailure(503)).toBe("retry");
	});
});
