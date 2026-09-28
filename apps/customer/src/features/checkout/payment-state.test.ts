import { describe, expect, it } from "bun:test";
import { donePageState, paymentState } from "./payment-state";

const o = (type: string, status: string) => ({ type, status });

describe("paymentState", () => {
	it("solo prenotazioni → none", () => {
		expect(paymentState([o("reserve_pickup", "confirmed")])).toBe("none");
	});
	it("un PR2 ancora pending → awaiting", () => {
		expect(
			paymentState([o("pay_pickup", "confirmed"), o("pay_pickup", "pending")]),
		).toBe("awaiting");
	});
	it("PR2 confermati → paid, anche se poi uno è annullato dal negozio", () => {
		expect(
			paymentState([
				o("pay_pickup", "confirmed"),
				o("pay_pickup", "cancelled"),
			]),
		).toBe("paid");
	});
	it("tutti i PR2 annullati senza pagamento → failed (le prenotazioni non contano)", () => {
		expect(
			paymentState([
				o("pay_pickup", "cancelled"),
				o("reserve_pickup", "confirmed"),
			]),
		).toBe("failed");
	});
});

describe("donePageState", () => {
	it("solo prenotazioni → none, a prescindere da hasPayment", () => {
		expect(donePageState([o("reserve_pickup", "confirmed")], false)).toBe(
			"none",
		);
	});
	it("PR2 pending con PI ancora pagabile → awaiting_payment (il cliente deve agire)", () => {
		expect(donePageState([o("pay_pickup", "pending")], true)).toBe(
			"awaiting_payment",
		);
	});
	it("PR2 pending con PI non più pagabile → awaiting_confirmation (si aspetta il webhook)", () => {
		expect(donePageState([o("pay_pickup", "pending")], false)).toBe(
			"awaiting_confirmation",
		);
	});
	it("PR2 confermati → paid", () => {
		expect(donePageState([o("pay_pickup", "confirmed")], false)).toBe("paid");
	});
	it("tutti i PR2 annullati → failed", () => {
		expect(donePageState([o("pay_pickup", "cancelled")], true)).toBe("failed");
	});
});
