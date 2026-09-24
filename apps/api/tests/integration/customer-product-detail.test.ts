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
import { product, storeProduct } from "@/db/schemas/product";
import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { getProductDetail } from "@/modules/customer/services/product-detail";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestBrand,
	createTestCategory,
	createTestDiscount,
	createTestDiscountProduct,
	createTestMacroCategory,
	createTestProduct,
	createTestProductImage,
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

// Roma, piazza Venezia; Bologna è a ~300 km, Milano a ~480 km.
const ROME = { lat: 41.8958, lng: 12.4823 };
const BOLOGNA = { lat: 44.4949, lng: 11.3426 };
const MILANO = { lat: 45.4642, lng: 9.19 };

async function visibleStore(
	sellerProfileId: string,
	name: string,
	at: { lat: number; lng: number },
) {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, { name, ...at });
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

/** Un prodotto in tre negozi visibili, tutti con giacenza. */
async function seedThreeStores() {
	const db = getTestDb();
	const { profile } = await createTestSeller(db);
	const milano = await visibleStore(profile.id, "A Milano", MILANO);
	const bologna = await visibleStore(profile.id, "B Bologna", BOLOGNA);
	const roma = await visibleStore(profile.id, "C Roma", ROME);
	const p = await createTestProduct(db, profile.id, {
		name: "Caffè",
		price: "10.00",
	});
	const spMilano = await createTestStoreProduct(db, milano.id, p.id, {
		stock: 3,
	});
	const spBologna = await createTestStoreProduct(db, bologna.id, p.id, {
		stock: 4,
	});
	const spRoma = await createTestStoreProduct(db, roma.id, p.id, { stock: 5 });
	return { db, profile, milano, bologna, roma, p, spMilano, spBologna, spRoma };
}

describe("getProductDetail — the attached store", () => {
	it("attaches the requested store when it has the product", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, {
			storeId: s.bologna.id,
			...ROME,
		});

		expect(d.offer.store.id).toBe(s.bologna.id);
		expect(d.offer.storeProductId).toBe(s.spBologna.id);
		expect(d.offer.stock).toBe(4);
		expect(d.requestedStoreUnavailable).toBe(false);
		expect(d.otherStoreCount).toBe(2);
	});

	it("attaches the nearest store without a requested one", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, { ...ROME });

		expect(d.offer.store.id).toBe(s.roma.id);
		expect(d.offer.distance).toBeGreaterThanOrEqual(0);
		expect(d.offer.distance).toBeLessThan(5_000);
		expect(d.requestedStoreUnavailable).toBe(false);
	});

	it("attaches the first store by name without store or origin", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, {});

		expect(d.offer.store.id).toBe(s.milano.id);
		expect(d.offer.distance).toBeNull();
	});

	it("falls back when the requested store is out of stock", async () => {
		const s = await seedThreeStores();
		await s.db
			.update(storeProduct)
			.set({ stock: 0 })
			.where(eq(storeProduct.id, s.spBologna.id));

		const d = await getProductDetail(s.p.id, {
			storeId: s.bologna.id,
			...ROME,
		});

		expect(d.offer.store.id).toBe(s.roma.id);
		expect(d.requestedStoreUnavailable).toBe(true);
		expect(d.otherStoreCount).toBe(1);
	});

	it("falls back when the requested store is hidden", async () => {
		const db = getTestDb();
		const s = await seedThreeStores();
		// Nessun abbonamento: il negozio non è pubblicamente visibile.
		const hidden = await createTestStore(db, s.profile.id, {
			name: "Nascosto",
			...ROME,
		});
		await createTestStoreProduct(db, hidden.id, s.p.id, { stock: 9 });

		const d = await getProductDetail(s.p.id, { storeId: hidden.id, ...ROME });

		expect(d.offer.store.id).toBe(s.roma.id);
		expect(d.requestedStoreUnavailable).toBe(true);
	});

	it("falls back when the requested store id does not exist", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, { storeId: "nope", ...ROME });

		expect(d.offer.store.id).toBe(s.roma.id);
		expect(d.requestedStoreUnavailable).toBe(true);
	});
});

describe("getProductDetail — visibility", () => {
	it("is 404 for an unknown product", async () => {
		await expect(getProductDetail("nope", {})).rejects.toMatchObject({
			status: 404,
		});
	});

	it("is 404 for a disabled or trashed product", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const st = await visibleStore(profile.id, "Negozio", ROME);
		for (const status of ["disabled", "trashed"] as const) {
			const p = await createTestProduct(db, profile.id, { status });
			await createTestStoreProduct(db, st.id, p.id, { stock: 5 });
			await expect(getProductDetail(p.id, {})).rejects.toMatchObject({
				status: 404,
			});
		}
	});

	it("is 404 when no visible store has it in stock", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const st = await visibleStore(profile.id, "Negozio", ROME);
		const hidden = await createTestStore(db, profile.id, { name: "Nascosto" });
		const p = await createTestProduct(db, profile.id);
		await createTestStoreProduct(db, st.id, p.id, { stock: 0 });
		await createTestStoreProduct(db, hidden.id, p.id, { stock: 5 });

		await expect(getProductDetail(p.id, {})).rejects.toMatchObject({
			status: 404,
		});
	});
});

describe("getProductDetail — the product", () => {
	it("returns images in order, discount, brand and category", async () => {
		const s = await seedThreeStores();
		const macro = await createTestMacroCategory(s.db, "Alimentari");
		const cat = await createTestCategory(s.db, "Caffè e tè", macro.id);
		const brand = await createTestBrand(s.db, s.profile.id, "Torrefazione");
		await s.db
			.update(product)
			.set({ productCategoryId: cat.id, brandId: brand.id })
			.where(eq(product.id, s.p.id));
		await createTestProductImage(s.db, s.p.id, {
			url: "https://img.test/b.jpg",
			position: 1,
		});
		await createTestProductImage(s.db, s.p.id, {
			url: "https://img.test/a.jpg",
			position: 0,
		});
		const disc = await createTestDiscount(s.db, s.profile.id, { percent: 20 });
		await createTestDiscountProduct(s.db, disc.id, s.p.id);

		const d = await getProductDetail(s.p.id, {});

		expect(d.name).toBe("Caffè");
		expect(d.price).toBe("10.00");
		expect(d.discountPercent).toBe(20);
		expect(d.discountedPrice).toBe("8.00");
		expect(d.brandName).toBe("Torrefazione");
		expect(d.category).toEqual({
			id: cat.id,
			name: "Caffè e tè",
			macroCategory: { id: macro.id, name: "Alimentari" },
		});
		expect(d.images.map((i) => i.url)).toEqual([
			"https://img.test/a.jpg",
			"https://img.test/b.jpg",
		]);
		expect(d.characteristics).toEqual([]);
	});

	it("returns null brand and category when unset", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, {});

		expect(d.brandName).toBeNull();
		expect(d.category).toBeNull();
		expect(d.discountPercent).toBeNull();
		expect(d.characteristics).toEqual([]);
	});

	it("embeds the characteristics", async () => {
		const s = await seedThreeStores();
		const cat = await createTestCategory(s.db, "Caffè in grani");
		const [peso] = await s.db
			.insert(productCharacteristic)
			.values([{ name: "Peso", dataType: "number", unit: "g" }])
			.returning();
		await s.db.insert(productCategoryCharacteristic).values({
			productCategoryId: cat.id,
			characteristicId: peso.id,
			sortOrder: 0,
		});
		await s.db
			.update(product)
			.set({ productCategoryId: cat.id })
			.where(eq(product.id, s.p.id));
		await s.db.insert(productCharacteristicValue).values({
			productId: s.p.id,
			characteristicId: peso.id,
			dataType: "number",
			valueNumber: "250",
		});

		const d = await getProductDetail(s.p.id, {});

		expect(d.characteristics).toEqual([
			{
				characteristicId: peso.id,
				name: "Peso",
				dataType: "number",
				unit: "g",
				value: 250,
			},
		]);
	});
});
