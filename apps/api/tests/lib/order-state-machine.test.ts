import { describe, expect, it } from "bun:test";
import { ServiceError } from "@/lib/errors";
import { assertTransition } from "@/lib/order-state-machine";

describe("assertTransition — valid transitions", () => {
	// pending →
	it("pending → confirmed (pay_pickup)", () => {
		expect(assertTransition("pending", "confirmed", "pay_pickup")).toBe(true);
	});
	it("pending → confirmed (pay_deliver)", () => {
		expect(assertTransition("pending", "confirmed", "pay_deliver")).toBe(true);
	});
	it("pending → confirmed (reserve_pickup)", () => {
		expect(assertTransition("pending", "confirmed", "reserve_pickup")).toBe(true);
	});
	it("pending → cancelled (pay_pickup)", () => {
		expect(assertTransition("pending", "cancelled", "pay_pickup")).toBe(true);
	});
	it("pending → cancelled (pay_deliver)", () => {
		expect(assertTransition("pending", "cancelled", "pay_deliver")).toBe(true);
	});
	it("pending → cancelled (reserve_pickup)", () => {
		expect(assertTransition("pending", "cancelled", "reserve_pickup")).toBe(true);
	});

	// confirmed →
	it("confirmed → ready_for_pickup (pay_pickup)", () => {
		expect(assertTransition("confirmed", "ready_for_pickup", "pay_pickup")).toBe(true);
	});
	it("confirmed → ready_for_pickup (pay_deliver)", () => {
		expect(assertTransition("confirmed", "ready_for_pickup", "pay_deliver")).toBe(true);
	});
	it("confirmed → ready_for_pickup (reserve_pickup)", () => {
		expect(assertTransition("confirmed", "ready_for_pickup", "reserve_pickup")).toBe(true);
	});
	it("confirmed → completed (pay_pickup)", () => {
		expect(assertTransition("confirmed", "completed", "pay_pickup")).toBe(true);
	});
	it("confirmed → completed (reserve_pickup)", () => {
		expect(assertTransition("confirmed", "completed", "reserve_pickup")).toBe(true);
	});
	it("confirmed → cancelled (pay_deliver)", () => {
		expect(assertTransition("confirmed", "cancelled", "pay_deliver")).toBe(true);
	});

	// ready_for_pickup →
	it("ready_for_pickup → shipped (pay_deliver)", () => {
		expect(assertTransition("ready_for_pickup", "shipped", "pay_deliver")).toBe(true);
	});
	it("ready_for_pickup → completed (pay_pickup)", () => {
		expect(assertTransition("ready_for_pickup", "completed", "pay_pickup")).toBe(true);
	});
	it("ready_for_pickup → completed (reserve_pickup)", () => {
		expect(assertTransition("ready_for_pickup", "completed", "reserve_pickup")).toBe(true);
	});

	// shipped →
	it("shipped → delivered (pay_deliver)", () => {
		expect(assertTransition("shipped", "delivered", "pay_deliver")).toBe(true);
	});
	it("shipped → completed (pay_deliver)", () => {
		expect(assertTransition("shipped", "completed", "pay_deliver")).toBe(true);
	});
});

describe("assertTransition — invalid transitions", () => {
	it("throws on pending → shipped (skip step)", () => {
		expect(() => assertTransition("pending", "shipped", "pay_deliver")).toThrow(ServiceError);
	});

	it("throws on pending → delivered", () => {
		expect(() => assertTransition("pending", "delivered", "pay_deliver")).toThrow(ServiceError);
	});

	it("throws on completed → cancelled (terminal status)", () => {
		expect(() => assertTransition("completed", "cancelled", "pay_pickup")).toThrow(ServiceError);
	});

	it("throws on cancelled → confirmed (terminal status)", () => {
		expect(() => assertTransition("cancelled", "confirmed", "pay_pickup")).toThrow(ServiceError);
	});

	it("throws on confirmed → completed for pay_deliver", () => {
		expect(() => assertTransition("confirmed", "completed", "pay_deliver")).toThrow(ServiceError);
	});

	it("throws on ready_for_pickup → shipped for pay_pickup (wrong type)", () => {
		expect(() => assertTransition("ready_for_pickup", "shipped", "pay_pickup")).toThrow(ServiceError);
	});

	it("throws on direct order transitions (not supported)", () => {
		expect(() => assertTransition("pending", "confirmed", "direct")).toThrow(ServiceError);
	});

	it("error has status 400", () => {
		try {
			assertTransition("pending", "shipped", "pay_deliver");
		} catch (e) {
			expect(e).toBeInstanceOf(ServiceError);
			expect((e as ServiceError).status).toBe(400);
		}
	});
});
