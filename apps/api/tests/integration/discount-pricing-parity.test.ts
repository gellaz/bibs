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

import { sql } from "drizzle-orm";
import { product } from "@/db/schemas/product";
import {
	bestActiveDiscountPercent,
	getBestActiveDiscounts,
} from "@/modules/seller/services/discount-pricing";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestDiscount,
	createTestDiscountProduct,
	createTestProduct,
	createTestSeller,
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

describe("bestActiveDiscountPercent — parità con getBestActiveDiscounts", () => {
	it("concorda su sconti attivi, scaduti, futuri, sospesi e sovrapposti", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const sp = seller.profile.id;

		// Nessuno sconto.
		const plain = await createTestProduct(db, sp, {
			name: "Senza",
			price: "100.00",
		});

		// Uno sconto attivo al 20%.
		const single = await createTestProduct(db, sp, {
			name: "Singolo",
			price: "100.00",
		});
		const d20 = await createTestDiscount(db, sp, { percent: 20 });
		await createTestDiscountProduct(db, d20.id, single.id);

		// Due sconti attivi: vince il più alto.
		const doubled = await createTestProduct(db, sp, {
			name: "Doppio",
			price: "100.00",
		});
		const d35 = await createTestDiscount(db, sp, { percent: 35 });
		await createTestDiscountProduct(db, d20.id, doubled.id);
		await createTestDiscountProduct(db, d35.id, doubled.id);

		// Scaduto.
		const expired = await createTestProduct(db, sp, {
			name: "Scaduto",
			price: "100.00",
		});
		const dOld = await createTestDiscount(db, sp, {
			percent: 50,
			startsAt: new Date(Date.now() - 7 * 86_400_000),
			endsAt: new Date(Date.now() - 86_400_000),
		});
		await createTestDiscountProduct(db, dOld.id, expired.id);

		// Non ancora iniziato.
		const future = await createTestProduct(db, sp, {
			name: "Futuro",
			price: "100.00",
		});
		const dNew = await createTestDiscount(db, sp, {
			percent: 50,
			startsAt: new Date(Date.now() + 86_400_000),
			endsAt: null,
		});
		await createTestDiscountProduct(db, dNew.id, future.id);

		// Sconto non attivo. `discountStatuses` = active | paused | archived.
		const paused = await createTestProduct(db, sp, {
			name: "Sospeso",
			price: "100.00",
		});
		const dPaused = await createTestDiscount(db, sp, {
			percent: 50,
			status: "paused",
		});
		await createTestDiscountProduct(db, dPaused.id, paused.id);

		const ids = [
			plain.id,
			single.id,
			doubled.id,
			expired.id,
			future.id,
			paused.id,
		];

		// Strada A: il frammento SQL, letto come colonna.
		const rows = await db
			.select({
				id: product.id,
				percent: sql<number | null>`${bestActiveDiscountPercent()}`.as(
					"percent",
				),
			})
			.from(product);
		const fromSql = new Map(rows.map((r) => [r.id, r.percent]));

		// Strada B: il batch esistente.
		const fromBatch = await getBestActiveDiscounts(ids, db as any);

		for (const id of ids) {
			expect(fromSql.get(id) ?? null).toBe(fromBatch.get(id)?.percent ?? null);
		}
		expect(fromSql.get(doubled.id)).toBe(35);
		expect(fromSql.get(plain.id)).toBeNull();
	});
});
