import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { eq } from "drizzle-orm";
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
mock.module("@/lib/s3", () => ({ s3: { delete: mock(async () => {}) } }));

import { product } from "@/db/schemas/product";
import { listProducts } from "@/modules/seller/services/products";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestBrand,
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

// Helper: imposta l'EAN su un prodotto già creato (fixture non lo espone).
async function setEan(productId: string, ean: string) {
	await getTestDb()
		.update(product)
		.set({ ean })
		.where(eq(product.id, productId));
}

describe("listProducts search (q)", () => {
	it("matches exact full-text term", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const target = await createTestProduct(db, seller.profile.id, {
			name: "Lavatrice Bosch Serie 4",
			description: "Lavatrice 7kg classe A",
		});
		await createTestProduct(db, seller.profile.id, {
			name: "Frigorifero Samsung",
			description: "Frigorifero combinato 350L",
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "lavatrice",
		});
		expect(out.data.map((p) => p.id)).toEqual([target.id]);
	});

	it("matches prefix (typing 'lava' finds 'Lavatrice')", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const target = await createTestProduct(db, seller.profile.id, {
			name: "Lavatrice Bosch",
		});
		await createTestProduct(db, seller.profile.id, { name: "Frigorifero" });

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "lava",
		});
		expect(out.data.map((p) => p.id)).toEqual([target.id]);
	});

	it("multi-token AND: matches when all tokens hit, misses otherwise", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const bosch = await createTestProduct(db, seller.profile.id, {
			name: "Lavatrice Bosch",
		});
		await createTestProduct(db, seller.profile.id, {
			name: "Lavatrice Whirlpool",
		});

		const hit = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "lava bosch",
		});
		expect(hit.data.map((p) => p.id)).toEqual([bosch.id]);

		const miss = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "lava sony",
		});
		expect(miss.data).toHaveLength(0);
	});

	it("matches with typo via trigram similarity", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const target = await createTestProduct(db, seller.profile.id, {
			name: "Lavatrice Bosch",
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "lavatrcie",
		});
		expect(out.data.map((p) => p.id)).toContain(target.id);
	});

	it("matches an exact EAN code", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const target = await createTestProduct(db, seller.profile.id, {
			name: "Whatever",
		});
		await setEan(target.id, "8001234567890");
		await createTestProduct(db, seller.profile.id, { name: "Other" });

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "8001234567890",
		});
		expect(out.data.map((p) => p.id)).toEqual([target.id]);
	});

	it("matches by brand name even when product name does not contain the term", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const samsung = await createTestBrand(db, seller.profile.id, "Samsung");
		const lg = await createTestBrand(db, seller.profile.id, "LG");
		const target = await createTestProduct(db, seller.profile.id, {
			name: "Frigorifero combinato 350L",
			brandId: samsung.id,
		});
		await createTestProduct(db, seller.profile.id, {
			name: "Frigorifero combinato 400L",
			brandId: lg.id,
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "samsung",
		});
		expect(out.data.map((p) => p.id)).toEqual([target.id]);
	});

	it("safely handles tsquery operators in input (no crash, no leakage)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestProduct(db, seller.profile.id, { name: "Foo" });

		// Operators like ';, |, &, !, parentheses, quotes are stripped by the
		// sanitizer. Should not throw, should not return everything.
		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "'; DROP TABLE products --",
		});
		// "drop" alone won't match "Foo", so we expect zero results.
		expect(out.data).toHaveLength(0);
	});

	it("ignores queries shorter than 2 effective characters", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "A" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "B" });

		const withQ = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "a",
		});
		const withoutQ = await listProducts({ sellerProfileId: seller.profile.id });
		expect(withQ.data.map((p) => p.id).sort()).toEqual(
			withoutQ.data.map((p) => p.id).sort(),
		);
		expect(withoutQ.data.map((p) => p.id).sort()).toEqual(
			[p1.id, p2.id].sort(),
		);
	});

	it("ranks name matches above description-only matches", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const nameHit = await createTestProduct(db, seller.profile.id, {
			name: "Lavatrice Bosch",
			description: "Elettrodomestico",
		});
		const descHit = await createTestProduct(db, seller.profile.id, {
			name: "Generic Item",
			description: "Compatibile con lavatrice Bosch",
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			q: "lavatrice",
		});
		const ids = out.data.map((p) => p.id);
		expect(ids).toContain(nameHit.id);
		expect(ids).toContain(descHit.id);
		expect(ids.indexOf(nameHit.id)).toBeLessThan(ids.indexOf(descHit.id));
	});

	it("composes with statusFilter (only matching products in the requested status)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestProduct(db, seller.profile.id, {
			name: "Lavatrice Bosch",
			status: "active",
		});
		const disabled = await createTestProduct(db, seller.profile.id, {
			name: "Lavatrice Whirlpool",
			status: "disabled",
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			statusFilter: "disabled",
			q: "lava",
		});
		expect(out.data.map((p) => p.id)).toEqual([disabled.id]);
	});
});
