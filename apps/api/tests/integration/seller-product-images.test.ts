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

mock.module("@/lib/s3", () => ({
	s3: {
		write: mock(async () => {}),
		delete: mock(async () => {}),
	},
	publicUrl: (key: string) => `https://cdn.test/${key}`,
}));

import { eq } from "drizzle-orm";
import { productImage } from "@/db/schemas/product-image";
import { uploadProductImages } from "@/modules/seller/services/images";
import { truncateAll } from "../helpers/cleanup";
import { createTestProduct, createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

function makeFile(name = "photo.jpg") {
	return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
}

describe("uploadProductImages — position assignment", () => {
	it("appends new images after existing ones instead of colliding at index 0", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const product = await createTestProduct(db, seller.profile.id);

		// Product already has one image at position 0.
		await db.insert(productImage).values({
			productId: product.id,
			url: "https://cdn.test/existing.jpg",
			key: `products/${product.id}/existing.jpg`,
			position: 0,
		});

		const result = await uploadProductImages({
			productId: product.id,
			sellerProfileId: seller.profile.id,
			userId: seller.user.id,
			isOwner: true,
			files: [makeFile()],
		});

		expect(result).toHaveLength(1);
		// Must append after the existing position 0, not reuse it.
		expect(result[0].position).toBe(1);
	});

	it("assigns contiguous positions when uploading multiple files onto existing images", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const product = await createTestProduct(db, seller.profile.id);

		// Two existing images at positions 0 and 1.
		await db.insert(productImage).values([
			{
				productId: product.id,
				url: "https://cdn.test/a.jpg",
				key: `products/${product.id}/a.jpg`,
				position: 0,
			},
			{
				productId: product.id,
				url: "https://cdn.test/b.jpg",
				key: `products/${product.id}/b.jpg`,
				position: 1,
			},
		]);

		await uploadProductImages({
			productId: product.id,
			sellerProfileId: seller.profile.id,
			userId: seller.user.id,
			isOwner: true,
			files: [makeFile("c.jpg"), makeFile("d.jpg")],
		});

		const all = await db.query.productImage.findMany({
			where: eq(productImage.productId, product.id),
		});
		const positions = all.map((r) => r.position).sort((a, b) => a - b);
		// 4 images total with no duplicate positions: 0,1,2,3.
		expect(positions).toEqual([0, 1, 2, 3]);
	});
});
