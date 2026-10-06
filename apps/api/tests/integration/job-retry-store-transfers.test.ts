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

const paymentIntentsRetrieve = mock(async (id: string) => ({
	id,
	status: "succeeded",
	latest_charge: "ch_1",
}));
let transferSeq = 0;
const transfersCreate = mock(async (p: any, _o?: any) => ({
	id: `tr_${++transferSeq}`,
	amount: p.amount,
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		paymentIntents: { retrieve: paymentIntentsRetrieve },
		transfers: { create: transfersCreate },
		refunds: { create: mock(async () => ({ id: "re_1" })) },
	},
}));

import { eq } from "drizzle-orm";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import { retryStoreTransfers } from "@/lib/jobs/retry-store-transfers";
import { toCents } from "@/lib/money";
import { storePayoutSplit } from "@/lib/platform-fee";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestSeller,
	createTestStore,
	enableOnlinePayments,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	paymentIntentsRetrieve.mockClear();
	transfersCreate.mockClear();
	transferSeq = 0;
});

/** Un PR2 pagato: per default lordo 12 €, 5 € di punti, il pagato già trasferito. */
async function seedPaid(values: Partial<typeof order.$inferInsert> = {}) {
	const db = getTestDb();
	const customer = await createTestCustomer(db);
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	await enableOnlinePayments(db, {
		sellerProfileId: seller.profile.id,
		storeId: store.id,
		accountId: `acct_${crypto.randomUUID()}`,
	});
	const [co] = await db
		.insert(checkout)
		.values({
			customerProfileId: customer.profile.id,
			idempotencyKey: crypto.randomUUID(),
			stripePaymentIntentId: `pi_${crypto.randomUUID()}`,
			amountDueOnline: "7.00",
		})
		.returning();
	const [o] = await db
		.insert(order)
		.values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "pay_pickup",
			status: "confirmed",
			total: "7.00",
			pointsDiscount: "5.00",
			platformFee: "0.60",
			checkoutId: co.id,
			stripeTransferId: "tr_paid",
			...values,
		})
		.returning();
	return { ...o, paymentIntentId: co.stripePaymentIntentId };
}

const reload = async (id: string) =>
	(await getTestDb().select().from(order).where(eq(order.id, id)))[0];

describe("retryStoreTransfers", () => {
	it("quota punti rimasta indietro (saldo bibs insufficiente): la ritenta", async () => {
		const o = await seedPaid();
		expect(await retryStoreTransfers()).toBe(1);

		expect(paymentIntentsRetrieve).toHaveBeenCalledWith(o.paymentIntentId);
		expect(transfersCreate).toHaveBeenCalledTimes(1);
		expect(transfersCreate.mock.calls[0][1]).toEqual({
			idempotencyKey: `points-transfer:${o.id}`,
		});
		expect((await reload(o.id)).stripePointsTransferId).toMatch(/^tr_/);
	});

	it("niente da trasferire: non chiama Stripe", async () => {
		// Trasferimenti già fatti.
		await seedPaid({ stripePointsTransferId: "tr_pts" });
		// Punti che non superano la commissione: il pagato copre il negozio.
		await seedPaid({
			total: "39.00",
			pointsDiscount: "1.00",
			platformFee: "2.00",
		});
		// Non ancora pagato: ci pensa il webhook o expireUnpaidOrders.
		await seedPaid({ status: "pending", stripeTransferId: null });

		expect(await retryStoreTransfers()).toBe(0);
		expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
		expect(transfersCreate).not.toHaveBeenCalled();
	});

	it("un errore su un checkout non ferma gli altri", async () => {
		await seedPaid();
		await seedPaid();
		paymentIntentsRetrieve.mockImplementationOnce(async () => {
			throw new Error("stripe down");
		});
		expect(await retryStoreTransfers()).toBe(1);
		expect(transfersCreate).toHaveBeenCalledTimes(1);
	});

	it("parità con storePayoutSplit: Stripe si interroga solo per gli ordini con un trasferimento da fare", async () => {
		const cases = [
			["7.00", "5.00", "0.60"],
			["0.00", "5.00", "0.25"],
			["39.00", "1.00", "2.00"],
			["10.00", "0.00", "0.50"],
			["0.30", "0.20", "0.03"],
			["1.00", "0.50", "0.50"],
		] as const;
		const expected: string[] = [];
		for (const [total, pointsDiscount, platformFee] of cases)
			for (const done of [
				{ stripeTransferId: null, stripePointsTransferId: null },
				{ stripeTransferId: "tr_a", stripePointsTransferId: null },
				{ stripeTransferId: null, stripePointsTransferId: "tr_b" },
			]) {
				const o = await seedPaid({
					total,
					pointsDiscount,
					platformFee,
					...done,
				});
				const split = storePayoutSplit({
					totalCents: toCents(total),
					pointsDiscountCents: toCents(pointsDiscount),
					platformFeeCents: toCents(platformFee),
				});
				if (
					(split.fromCharge > 0 && !done.stripeTransferId) ||
					(split.fromBalance > 0 && !done.stripePointsTransferId)
				)
					expected.push(o.paymentIntentId as string);
			}

		await retryStoreTransfers();
		const asked = paymentIntentsRetrieve.mock.calls.map(([id]) => id);
		expect(asked.sort()).toEqual(expected.sort());
	});
});
