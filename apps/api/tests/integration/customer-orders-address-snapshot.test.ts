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

import { eq } from "drizzle-orm";
import { customerAddress } from "@/db/schemas/address";
import { order } from "@/db/schemas/order";
import { createOrder } from "@/modules/customer/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestCustomerAddress,
	createTestMunicipality,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function seedDeliveryOrder() {
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
	const municipality = await createTestMunicipality(db, {
		municipalityName: "Bologna",
		// La fixture riusa la provincia per nome: senza un nome proprio
		// restituirebbe quella dello store («Test Province», TT).
		provinceName: "Bologna",
		provinceAcronym: "BO",
	});
	const address = await createTestCustomerAddress(db, customer.profile.id, {
		addressLine1: "Via Indipendenza 10",
		municipalityId: municipality.id,
		zipCode: "40121",
	});
	const created = await createOrder({
		customerProfileId: customer.profile.id,
		customerPoints: 0,
		type: "pay_deliver",
		storeId: store.id,
		items: [{ storeProductId: sp.id, quantity: 1 }],
		shippingAddressId: address.id,
	});
	return { db, address, created };
}

describe("createOrder — snapshot dell'indirizzo", () => {
	it("salva sull'ordine una copia dell'indirizzo di spedizione", async () => {
		const { created } = await seedDeliveryOrder();

		expect(created.shippingAddressSnapshot).toEqual({
			recipientName: null,
			phone: null,
			addressLine1: "Via Indipendenza 10",
			addressLine2: null,
			zipCode: "40121",
			municipalityName: "Bologna",
			provinceAcronym: "BO",
			country: "IT",
		});
	});

	it("l'ordine conserva lo snapshot quando l'indirizzo viene cancellato", async () => {
		const { db, address, created } = await seedDeliveryOrder();

		await db.delete(customerAddress).where(eq(customerAddress.id, address.id));

		const [after] = await db
			.select()
			.from(order)
			.where(eq(order.id, created.id));
		expect(after.shippingAddressId).toBeNull();
		expect(after.shippingAddressSnapshot?.addressLine1).toBe(
			"Via Indipendenza 10",
		);
		expect(after.shippingAddressSnapshot?.municipalityName).toBe("Bologna");
	});

	it("gli ordini da ritirare non hanno snapshot", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		await createTestStoreSubscription(db, store.id);
		const product = await createTestProduct(db, seller.profile.id);
		const sp = await createTestStoreProduct(db, store.id, product.id, {
			stock: 5,
		});
		const customer = await createTestCustomer(db);

		const created = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(created.shippingAddressSnapshot).toBeNull();
	});
});
