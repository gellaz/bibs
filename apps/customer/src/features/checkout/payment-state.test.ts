import { describe, expect, it } from "bun:test";
import { paymentState } from "./payment-state";

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
