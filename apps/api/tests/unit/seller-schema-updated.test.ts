import { describe, expect, it } from "bun:test";
import { onboardingStatuses, sellerProfile } from "@/db/schemas/seller";

describe("sellerProfile schema (post-billing rework)", () => {
	it("onboardingStatuses array contains 7 statuses (no pending_store/team/payment)", () => {
		expect(onboardingStatuses).toEqual([
			"pending_email",
			"pending_personal",
			"pending_document",
			"pending_company",
			"pending_review",
			"active",
			"rejected",
		]);
	});

	it("declares stripeCustomerId column", () => {
		expect(Object.keys(sellerProfile)).toContain("stripeCustomerId");
	});
});
