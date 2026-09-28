import { describe, expect, it } from "bun:test";
import {
	canCustomerCancel,
	formatCountdown,
	pickupDeadline,
} from "./order-display";

describe("pickupDeadline", () => {
	const now = Date.parse("2026-09-25T09:00:00+02:00");
	it("mostra data e ora di scadenza e il tempo residuo", () => {
		const d = pickupDeadline("2026-09-27T09:30:00+02:00", now);
		expect(d.expired).toBe(false);
		expect(d.left).toBe("tra 48 h");
		expect(d.date).toContain("27");
	});
	it("sotto l'ora passa ai minuti", () => {
		expect(pickupDeadline(new Date(now + 25 * 60_000), now).left).toBe(
			"tra 25 min",
		);
	});
	it("scaduta", () => {
		expect(pickupDeadline(new Date(now - 1000), now).expired).toBe(true);
	});
});

describe("canCustomerCancel", () => {
	it("solo prenotazioni ancora da preparare", () => {
		expect(
			canCustomerCancel({ status: "confirmed", type: "reserve_pickup" }),
		).toBe(true);
		expect(
			canCustomerCancel({ status: "ready_for_pickup", type: "reserve_pickup" }),
		).toBe(false);
		expect(
			canCustomerCancel({ status: "completed", type: "reserve_pickup" }),
		).toBe(false);
	});
});

describe("canCustomerCancel", () => {
	it("un Paga e ritira in attesa di pagamento non si annulla a mano", () => {
		expect(canCustomerCancel({ type: "pay_pickup", status: "pending" })).toBe(
			false,
		);
	});
	it("un Paga e ritira confermato sì (con rimborso)", () => {
		expect(canCustomerCancel({ type: "pay_pickup", status: "confirmed" })).toBe(
			true,
		);
	});
	it("una prenotazione confermata sì", () => {
		expect(
			canCustomerCancel({ type: "reserve_pickup", status: "confirmed" }),
		).toBe(true);
	});
});

describe("formatCountdown", () => {
	it("ore:minuti:secondi, ore oltre le 24", () => {
		expect(formatCountdown(47 * 3_600_000 + 59 * 60_000 + 12_000)).toBe(
			"47:59:12",
		);
		expect(formatCountdown(65_000)).toBe("00:01:05");
	});
	it("mai negativo", () => {
		expect(formatCountdown(-5000)).toBe("00:00:00");
	});
});
