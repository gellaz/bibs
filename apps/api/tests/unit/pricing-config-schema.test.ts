import { describe, expect, it } from "bun:test";
import { pricingConfig } from "@/db/schemas/pricing-config";

describe("pricingConfig schema", () => {
	it("has expected columns", () => {
		const cols = Object.keys(pricingConfig);
		expect(cols).toEqual(
			expect.arrayContaining([
				"id",
				"storeMonthlyFeeCents",
				"currency",
				"stripePriceId",
				"suspendedAutoCancelDays",
				"pendingCreationExpiryHours",
				"isActive",
				"createdAt",
				"createdByUserId",
			]),
		);
	});
});
