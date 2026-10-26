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
} from "../../../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

import { eq } from "drizzle-orm";
import { customerProfile as customerProfileTable } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { createOrder } from "@/modules/customer/services/orders";
import { truncateAll } from "../../../helpers/cleanup";
import {
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
} from "../../../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function seed() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, seller.profile.id, {
		price: "10.00",
	});
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 5,
	});
	const customer = await createTestCustomer(db);
	return { store, sp, customer };
}

describe("placeOrder — pay_*", () => {
	it("pay_pickup nasce pending, con scadenza a 30 minuti, commissione e stock già tolto", async () => {
		const { store, sp, customer } = await seed();
		const before = Date.now();
		const created = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "pay_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 2 }],
		});
		expect(created.status).toBe("pending");
		expect(created.platformFee).toBe("1.00"); // 5% di 20,00
		const exp = created.paymentExpiresAt?.getTime() ?? 0;
		expect(exp).toBeGreaterThanOrEqual(before + 30 * 60_000 - 1000);
		expect(exp).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);
		const [row] = await getTestDb()
			.select()
			.from(order)
			.where(eq(order.id, created.id));
		expect(row.status).toBe("pending");
	});

	it("reserve_pickup resta confirmed, senza scadenza di pagamento né commissione", async () => {
		const { store, sp, customer } = await seed();
		const created = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});
		expect(created.status).toBe("confirmed");
		expect(created.paymentExpiresAt).toBeNull();
		expect(created.platformFee).toBe("0.00");
	});
});

// `direct` (pagamento in negozio via QR) non è ancora costruito: finché non c'è
// il pagamento, un ordine direct nasceva `completed` e accreditava punti
// senza incasso. Nessun ingresso deve accettarlo.
describe("direct — niente ordini (né punti) senza pagamento", () => {
	async function ledger(customerProfileId: string) {
		const db = getTestDb();
		const [cp] = await db
			.select()
			.from(customerProfileTable)
			.where(eq(customerProfileTable.id, customerProfileId));
		const txs = await db
			.select()
			.from(pointTransaction)
			.where(eq(pointTransaction.customerProfileId, customerProfileId));
		return { points: cp.points, txs };
	}

	it("createOrder rifiuta direct con 400, senza scrivere nulla", async () => {
		const { store, sp, customer } = await seed();
		await expect(
			createOrder({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				type: "direct",
				storeId: store.id,
				items: [{ storeProductId: sp.id, quantity: 5 }],
			}),
		).rejects.toMatchObject({ status: 400 });
		expect(await getTestDb().select().from(order)).toHaveLength(0);
		expect(await ledger(customer.profile.id)).toEqual({ points: 0, txs: [] });
	});
});
