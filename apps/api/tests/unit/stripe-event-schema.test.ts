import { describe, expect, it } from "bun:test";
import { stripeEvent } from "@/db/schemas/stripe-event";

describe("stripeEvent schema", () => {
	it("has expected columns", () => {
		const cols = Object.keys(stripeEvent);
		expect(cols).toEqual(
			expect.arrayContaining([
				"eventId",
				"eventType",
				"receivedAt",
				"processedAt",
			]),
		);
	});
});
