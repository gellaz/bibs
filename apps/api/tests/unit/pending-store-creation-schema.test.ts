import { describe, expect, it } from "bun:test";
import {
	pendingStoreCreation,
	pendingStoreCreationStatuses,
} from "@/db/schemas/pending-store-creation";

describe("pendingStoreCreation schema", () => {
	it("declares the 4 lifecycle statuses", () => {
		expect(pendingStoreCreationStatuses).toEqual([
			"open",
			"consumed",
			"expired",
			"canceled",
		]);
	});

	it("has expected columns", () => {
		const cols = Object.keys(pendingStoreCreation);
		expect(cols).toEqual(
			expect.arrayContaining([
				"id",
				"sellerProfileId",
				"formData",
				"stripeCheckoutSessionId",
				"stripeSubscriptionId",
				"feeAmountCents",
				"currency",
				"status",
				"expiresAt",
				"consumedAt",
				"createdAt",
			]),
		);
	});
});
