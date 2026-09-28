import { describe, expect, it } from "bun:test";
import { canCancel } from "./order-labels";

describe("canCancel", () => {
	it("un Paga e ritira in attesa di pagamento non si annulla (si annulla da solo)", () => {
		expect(canCancel({ type: "pay_pickup", status: "pending" })).toBe(false);
	});
	it("un Paga e ritira confermato sì (con rimborso)", () => {
		expect(canCancel({ type: "pay_pickup", status: "confirmed" })).toBe(true);
	});
	it("una prenotazione confermata sì, un ordine pronto no", () => {
		expect(canCancel({ type: "reserve_pickup", status: "confirmed" })).toBe(
			true,
		);
		expect(
			canCancel({ type: "reserve_pickup", status: "ready_for_pickup" }),
		).toBe(false);
	});
	it("un acquisto diretto mai", () => {
		expect(canCancel({ type: "direct", status: "confirmed" })).toBe(false);
	});
});
