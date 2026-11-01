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

import { listBrands } from "@/modules/seller/services/brands";
import { truncateAll } from "../../../helpers/cleanup";
import { createTestBrand, createTestSeller } from "../../../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("listBrands", () => {
	it("returns empty list when seller has no brands", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const result = await listBrands({ sellerProfileId: seller.profile.id });

		expect(result.data).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});

	it("returns only brands of the requesting seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		await createTestBrand(db, sellerA.profile.id, "Nike");
		await createTestBrand(db, sellerB.profile.id, "Adidas");

		const result = await listBrands({ sellerProfileId: sellerA.profile.id });

		expect(result.data).toHaveLength(1);
		expect(result.data[0].name).toBe("Nike");
	});

	it("filters by q case-insensitively", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestBrand(db, seller.profile.id, "Nike");
		await createTestBrand(db, seller.profile.id, "Adidas");
		await createTestBrand(db, seller.profile.id, "Puma");

		const result = await listBrands({
			sellerProfileId: seller.profile.id,
			q: "ad",
		});

		expect(result.data).toHaveLength(1);
		expect(result.data[0].name).toBe("Adidas");
	});

	it("paginates correctly", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		for (let i = 0; i < 25; i++) {
			await createTestBrand(db, seller.profile.id, `Brand ${i}`);
		}

		const page1 = await listBrands({
			sellerProfileId: seller.profile.id,
			page: 1,
			limit: 10,
		});
		const page3 = await listBrands({
			sellerProfileId: seller.profile.id,
			page: 3,
			limit: 10,
		});

		expect(page1.data).toHaveLength(10);
		expect(page3.data).toHaveLength(5);
		expect(page1.pagination.total).toBe(25);
	});
});
