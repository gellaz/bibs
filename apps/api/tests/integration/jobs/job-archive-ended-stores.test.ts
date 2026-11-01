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
} from "../../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

const sendEmail = mock(
	async (_params: { to: string; subject: string; html: string }) => {},
);
mock.module("@/infra/email", () => ({ sendEmail }));

import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { type OrderStatus, order } from "@/db/schemas/order";
import { store } from "@/db/schemas/store";
import {
	type StoreSubscriptionStatus,
	storeSubscription,
} from "@/db/schemas/store-subscription";
import { getSellerStoreIds } from "@/domain/sellers/access";
import { archiveEndedStores } from "@/jobs/archive-ended-stores";
import { priceOrder } from "@/modules/customer/services/orders";
import {
	listSellerOrders,
	transitionOrder,
} from "@/modules/seller/services/orders";
import { handleSubscriptionDeleted } from "@/modules/webhooks/services/handlers/subscription-deleted";
import { truncateAll } from "../../helpers/cleanup";
import {
	createTestCustomer,
	createTestSeller,
	createTestStore,
} from "../../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	sendEmail.mockReset();
	sendEmail.mockImplementation(async () => {});
});

async function seedStore(
	subStatus: StoreSubscriptionStatus | null,
	orderStatus: OrderStatus | null,
	cancelReason: string | null = null,
) {
	const db = getTestDb();
	const { profile } = await createTestSeller(db);
	const storeRow = await createTestStore(db, profile.id);
	if (subStatus)
		await db.insert(storeSubscription).values({
			storeId: storeRow.id,
			stripeSubscriptionId: `sub_${storeRow.id}`,
			stripeCustomerId: "cus_FAKE",
			stripePriceId: "price_FAKE",
			feeAmountCents: 2900,
			status: subStatus,
			currentPeriodEnd: new Date(),
			cancelReason,
		});
	let orderId: string | null = null;
	if (orderStatus) {
		const customer = await createTestCustomer(db);
		const [o] = await db
			.insert(order)
			.values({
				customerProfileId: customer.profile.id,
				storeId: storeRow.id,
				type: "reserve_pickup",
				status: orderStatus,
				total: "10.00",
			})
			.returning();
		orderId = o.id;
	}
	return { sellerProfileId: profile.id, storeId: storeRow.id, orderId };
}

async function deletedAt(storeId: string) {
	const [row] = await getTestDb()
		.select({ deletedAt: store.deletedAt })
		.from(store)
		.where(eq(store.id, storeId));
	return row.deletedAt;
}

describe("archiveEndedStores", () => {
	it("archivia ad abbonamento chiuso solo i negozi senza ordini aperti", async () => {
		const open = ["pending", "confirmed", "ready_for_pickup", "shipped"];
		const closed = ["delivered", "completed", "cancelled", "expired"];
		const stores = new Map<string, string>();
		for (const status of [...open, ...closed] as OrderStatus[])
			stores.set(status, (await seedStore("canceled", status)).storeId);
		const untouched = [
			await seedStore("active", null),
			await seedStore("suspended", null),
			await seedStore(null, null),
		];

		expect(await archiveEndedStores()).toBe(closed.length);

		for (const status of open)
			expect(await deletedAt(stores.get(status) as string)).toBeNull();
		for (const status of closed)
			expect(await deletedAt(stores.get(status) as string)).not.toBeNull();
		for (const { storeId } of untouched)
			expect(await deletedAt(storeId)).toBeNull();
		expect(sendEmail).toHaveBeenCalledTimes(closed.length);
	});

	it("abbonamento chiuso con un ordine aperto: niente archivio finché il titolare non lo chiude, poi una volta sola", async () => {
		const { sellerProfileId, storeId, orderId } = await seedStore(
			"canceling",
			"confirmed",
			"seller_canceled",
		);

		await handleSubscriptionDeleted({
			data: { object: { id: `sub_${storeId}` } },
		} as Stripe.Event);

		const [sub] = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.storeId, storeId));
		expect(sub.status).toBe("canceled");
		expect(await deletedAt(storeId)).toBeNull();
		expect(sendEmail).not.toHaveBeenCalled();
		expect(await archiveEndedStores()).toBe(0);

		// Nessun ordine nuovo: il negozio non è più vendibile.
		const customer = await createTestCustomer(getTestDb());
		const err = await getTestDb()
			.transaction((tx) =>
				priceOrder(tx, {
					customerProfileId: customer.profile.id,
					type: "reserve_pickup",
					storeId,
					items: [],
				}),
			)
			.catch((e) => e);
		expect(err.status).toBe(404);

		// Il titolare vede ancora l'ordine e lo chiude.
		const storeIds = await getSellerStoreIds(sellerProfileId);
		expect(storeIds).toContain(storeId);
		const listed = await listSellerOrders({ storeIds });
		expect(listed.data.map((o) => o.id)).toEqual([orderId as string]);
		await transitionOrder(
			orderId as string,
			sellerProfileId,
			"completed",
			storeIds,
		);

		expect(await archiveEndedStores()).toBe(1);
		const archivedAt = await deletedAt(storeId);
		expect(archivedAt).not.toBeNull();
		expect(sendEmail).toHaveBeenCalledTimes(1);
		const [{ subject, html }] = sendEmail.mock.calls[0];
		expect(subject).toContain("è stato archiviato");
		expect(html).toContain("come hai richiesto");

		// Idempotente: nessun secondo archivio, nessuna seconda email.
		expect(await archiveEndedStores()).toBe(0);
		expect(await deletedAt(storeId)).toEqual(archivedAt);
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});
});
