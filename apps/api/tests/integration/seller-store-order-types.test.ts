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

import { paymentMethod } from "@/db/schemas/payment-method";
import {
	getStoreOrderTypes,
	updateStoreOrderTypes,
} from "@/modules/seller/services/order-types";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function setup(
	opts: {
		chargesEnabled?: boolean;
		orderTypes?: ("reserve_pickup" | "pay_pickup")[];
	} = {},
) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id, {
		orderTypes: opts.orderTypes,
	});
	if (opts.chargesEnabled !== undefined)
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_T",
			chargesEnabled: opts.chargesEnabled,
		});
	return { sellerProfileId: seller.profile.id, storeId: store.id };
}

describe("tipologie d'acquisto del negozio", () => {
	it("GET: configurate, offerte e stato incassi", async () => {
		const s = await setup({
			chargesEnabled: true,
			orderTypes: ["reserve_pickup", "pay_pickup"],
		});
		expect(await getStoreOrderTypes(s)).toEqual({
			orderTypes: ["reserve_pickup", "pay_pickup"],
			offeredOrderTypes: ["reserve_pickup"], // ONLINE_PAYMENT_LIVE = false
			chargesEnabled: true,
		});
	});

	it("attivare pay_pickup senza conto abilitato → 400, niente scritto", async () => {
		const s = await setup({ chargesEnabled: false });
		await expect(
			updateStoreOrderTypes({
				...s,
				orderTypes: ["reserve_pickup", "pay_pickup"],
			}),
		).rejects.toMatchObject({ status: 400 });
		expect((await getStoreOrderTypes(s)).orderTypes).toEqual([
			"reserve_pickup",
		]);
	});

	it("senza nessuna riga payment_methods è come un conto non abilitato", async () => {
		const s = await setup();
		await expect(
			updateStoreOrderTypes({
				...s,
				orderTypes: ["reserve_pickup", "pay_pickup"],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("con conto abilitato si attiva pay_pickup", async () => {
		const s = await setup({ chargesEnabled: true });
		const res = await updateStoreOrderTypes({
			...s,
			orderTypes: ["pay_pickup", "reserve_pickup"],
		});
		expect(res.orderTypes).toEqual(["reserve_pickup", "pay_pickup"]); // ordine canonico
	});

	it("deve restare almeno una tipologia offerta: solo pay_pickup prima della PR F → 400", async () => {
		const s = await setup({
			chargesEnabled: true,
			orderTypes: ["reserve_pickup", "pay_pickup"],
		});
		await expect(
			updateStoreOrderTypes({ ...s, orderTypes: ["pay_pickup"] }),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("conto disabilitato dopo: tenere pay_pickup acceso non blocca il salvataggio", async () => {
		const s = await setup({
			chargesEnabled: false,
			orderTypes: ["reserve_pickup", "pay_pickup"],
		});
		const res = await updateStoreOrderTypes({
			...s,
			orderTypes: ["reserve_pickup", "pay_pickup"],
		});
		expect(res).toEqual({
			orderTypes: ["reserve_pickup", "pay_pickup"],
			offeredOrderTypes: ["reserve_pickup"],
			chargesEnabled: false,
		});
	});

	it("spegnere pay_pickup è sempre permesso", async () => {
		const s = await setup({
			chargesEnabled: false,
			orderTypes: ["reserve_pickup", "pay_pickup"],
		});
		const res = await updateStoreOrderTypes({
			...s,
			orderTypes: ["reserve_pickup"],
		});
		expect(res.orderTypes).toEqual(["reserve_pickup"]);
	});

	it("negozio di un altro seller → 404", async () => {
		const a = await setup();
		const b = await setup();
		await expect(
			updateStoreOrderTypes({
				sellerProfileId: b.sellerProfileId,
				storeId: a.storeId,
				orderTypes: ["reserve_pickup"],
			}),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			getStoreOrderTypes({
				sellerProfileId: b.sellerProfileId,
				storeId: a.storeId,
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});
