import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

const invoicesList = mock(async () => ({
	data: [
		{
			id: "in_1",
			created: 1700000000,
			amount_paid: 2900,
			currency: "eur",
			status: "paid",
			invoice_pdf: "https://stripe.test/in_1.pdf",
			parent: { subscription_details: { subscription: "sub_FAKE" } },
			lines: { data: [{ description: "Test Store" }] },
		},
	],
	has_more: false,
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		invoices: { list: invoicesList },
	},
}));

import { eq } from "drizzle-orm";
import { sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";
import { listInvoices } from "@/modules/seller/services/billing";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	invoicesList.mockClear();
});

describe("listInvoices", () => {
	it("calls stripe.invoices.list with the seller's customer id", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		await getTestDb()
			.update(sellerProfile)
			.set({ stripeCustomerId: "cus_FAKE" })
			.where(eq(sellerProfile.id, profile.id));

		const result = await listInvoices({
			sellerProfileId: profile.id,
			limit: 10,
			startingAfter: undefined,
		});

		expect(invoicesList).toHaveBeenCalledWith({
			customer: "cus_FAKE",
			limit: 10,
		});
		expect(result.data).toHaveLength(1);
		expect(result.data[0].amountPaidCents).toBe(2900);
		expect(result.data[0].stripeSubscriptionId).toBe("sub_FAKE");
		expect(result.hasMore).toBe(false);
	});

	it("throws when seller has no stripeCustomerId yet", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		await expect(
			listInvoices({
				sellerProfileId: profile.id,
				limit: 10,
				startingAfter: undefined,
			}),
		).rejects.toBeInstanceOf(ServiceError);
	});
});
