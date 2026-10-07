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
			total: 2900,
			amount_paid: 2900,
			currency: "eur",
			status: "paid",
			invoice_pdf: "https://stripe.test/in_1.pdf",
			parent: { subscription_details: { subscription: "sub_FAKE" } },
			lines: { data: [{ description: "Test Store" }] },
		},
		// Rinnovo fallito: niente incassato, ma la fattura vale 29,00 €.
		{
			id: "in_2",
			created: 1700100000,
			total: 2900,
			amount_paid: 0,
			currency: "eur",
			status: "open",
			invoice_pdf: "https://stripe.test/in_2.pdf",
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
		expect(result.data).toHaveLength(2);
		expect(result.data[0].totalCents).toBe(2900);
		expect(result.data[0].stripeSubscriptionId).toBe("sub_FAKE");
		expect(result.hasMore).toBe(false);
	});

	it("shows the invoice total even when nothing was paid (#250)", async () => {
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

		expect(result.data[1]).toMatchObject({
			id: "in_2",
			status: "open",
			totalCents: 2900,
		});
	});

	// Nessun Customer Stripe = nessuna fattura: una lista vuota, non un 404
	// che il client riproverebbe.
	it("returns an empty page when seller has no stripeCustomerId yet", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		const result = await listInvoices({
			sellerProfileId: profile.id,
			limit: 10,
			startingAfter: undefined,
		});
		expect(result).toEqual({ data: [], hasMore: false });
	});
});
