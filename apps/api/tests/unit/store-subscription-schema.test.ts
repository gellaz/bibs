import { describe, expect, it } from "bun:test";
import {
	storeSubscription,
	storeSubscriptionStatuses,
} from "@/db/schemas/store-subscription";

describe("storeSubscription schema", () => {
	it("declares the 5 lifecycle statuses", () => {
		expect(storeSubscriptionStatuses).toEqual([
			"active",
			"past_due",
			"canceling",
			"suspended",
			"canceled",
		]);
	});

	it("has expected columns", () => {
		const cols = Object.keys(storeSubscription);
		expect(cols).toEqual(
			expect.arrayContaining([
				"id",
				"storeId",
				"stripeSubscriptionId",
				"stripeCustomerId",
				"stripePriceId",
				"feeAmountCents",
				"currency",
				"status",
				"currentPeriodEnd",
				"cancelAtPeriodEnd",
				"cancelReason",
				"suspendedAt",
				"canceledAt",
			]),
		);
	});
});
