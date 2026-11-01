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

mock.module("@/infra/s3", () => ({
	s3: {
		write: mock(async () => {}),
		delete: mock(async () => {}),
	},
	publicUrl: (key: string) => `https://cdn.test/${key}`,
}));

import { eq } from "drizzle-orm";
import { productImage } from "@/db/schemas/product-image";
import { s3 } from "@/infra/s3";
import { config } from "@/lib/config";
import { uploadProductImages } from "@/modules/seller/services/images";
import { uploadStoreImages } from "@/modules/seller/services/store-images";
import { truncateAll } from "../../../helpers/cleanup";
import {
	createTestProduct,
	createTestProductImage,
	createTestSeller,
	createTestStore,
	createTestStoreImage,
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

// Il flusso è uno solo (image-upload.ts): il tetto e il suo messaggio
// dipendono da chi lo chiama.
describe("tetto delle foto, prima di toccare S3", () => {
	it("prodotto: 400 con il tetto dei prodotti", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const product = await createTestProduct(db, seller.profile.id);
		for (let i = 0; i < config.maxImagesPerProduct; i++)
			await createTestProductImage(db, product.id, { position: i });
		(s3.write as ReturnType<typeof mock>).mockClear();

		await expect(
			uploadProductImages({
				productId: product.id,
				sellerProfileId: seller.profile.id,
				userId: seller.user.id,
				isOwner: true,
				files: [makeFile()],
			}),
		).rejects.toMatchObject({
			status: 400,
			message:
				"Massimo 10 immagini per prodotto (attuali: 10, in caricamento: 1)",
		});
		expect(s3.write).not.toHaveBeenCalled();
	});

	it("negozio: 400 con il tetto dei negozi", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		for (let i = 0; i < config.maxImagesPerStore - 1; i++)
			await createTestStoreImage(db, store.id, { position: i });
		(s3.write as ReturnType<typeof mock>).mockClear();

		await expect(
			uploadStoreImages({
				storeId: store.id,
				sellerProfileId: seller.profile.id,
				userId: seller.user.id,
				isOwner: true,
				files: [makeFile("a.jpg"), makeFile("b.jpg")],
			}),
		).rejects.toMatchObject({
			status: 400,
			message: "Massimo 8 immagini per negozio (attuali: 7, in caricamento: 2)",
		});
		expect(s3.write).not.toHaveBeenCalled();
	});
});
