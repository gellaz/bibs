import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { product, productClassification } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";
import { s3 } from "@/lib/s3";

interface ListProductsParams {
	sellerProfileId: string;
	page?: number;
	limit?: number;
}

export async function listProducts(params: ListProductsParams) {
	const { sellerProfileId } = params;
	const { page, limit, offset } = parsePagination(params);

	const [data, [{ total }]] = await Promise.all([
		db.query.product.findMany({
			where: eq(product.sellerProfileId, sellerProfileId),
			with: {
				productClassifications: { with: { category: true } },
				storeProducts: { with: { store: { columns: { location: false } } } },
				images: { orderBy: (img, { asc }) => [asc(img.position)] },
			},
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(product)
			.where(eq(product.sellerProfileId, sellerProfileId)),
	]);

	return { data, pagination: { page, limit, total } };
}

interface GetProductParams {
	productId: string;
	sellerProfileId: string;
}

export async function getProduct(params: GetProductParams) {
	const { productId, sellerProfileId } = params;

	const found = await db.query.product.findFirst({
		where: and(
			eq(product.id, productId),
			eq(product.sellerProfileId, sellerProfileId),
		),
		with: {
			productClassifications: { with: { category: true } },
			storeProducts: { with: { store: { columns: { location: false } } } },
			images: { orderBy: (img, { asc }) => [asc(img.position)] },
		},
	});

	if (!found) throw new ServiceError(404, "Product not found");
	return found;
}

interface CreateProductParams {
	sellerProfileId: string;
	name: string;
	description?: string;
	price: string;
	categoryIds: string[];
}

export async function createProduct(params: CreateProductParams) {
	const { sellerProfileId, categoryIds, ...productData } = params;

	return db.transaction(async (tx) => {
		const [created] = await tx
			.insert(product)
			.values({ sellerProfileId, ...productData })
			.returning();

		if (categoryIds.length > 0) {
			await tx.insert(productClassification).values(
				categoryIds.map((categoryId) => ({
					productId: created.id,
					productCategoryId: categoryId,
				})),
			);
		}

		return created;
	});
}

interface UpdateProductParams {
	productId: string;
	sellerProfileId: string;
	categoryIds?: string[];
	imageOrder?: string[];
	name?: string;
	description?: string;
	price?: string;
}

export async function updateProduct(params: UpdateProductParams) {
	const {
		productId,
		sellerProfileId,
		categoryIds,
		imageOrder,
		...productData
	} = params;

	return db.transaction(async (tx) => {
		const [updated] = await tx
			.update(product)
			.set(productData)
			.where(
				and(
					eq(product.id, productId),
					eq(product.sellerProfileId, sellerProfileId),
				),
			)
			.returning();

		if (!updated) return null;

		if (categoryIds) {
			await tx
				.delete(productClassification)
				.where(eq(productClassification.productId, updated.id));

			if (categoryIds.length > 0) {
				await tx.insert(productClassification).values(
					categoryIds.map((categoryId) => ({
						productId: updated.id,
						productCategoryId: categoryId,
					})),
				);
			}
		}

		if (imageOrder) {
			for (let i = 0; i < imageOrder.length; i++) {
				await tx
					.update(productImage)
					.set({ position: i })
					.where(
						and(
							eq(productImage.id, imageOrder[i]),
							eq(productImage.productId, updated.id),
						),
					);
			}
		}

		return updated;
	});
}

interface DeleteProductParams {
	productId: string;
	sellerProfileId: string;
}

export async function deleteProduct(params: DeleteProductParams) {
	const { productId, sellerProfileId } = params;

	// Fetch images to clean up S3 before cascade-deleting the product
	const images = await db.query.productImage.findMany({
		where: eq(productImage.productId, productId),
		columns: { key: true },
	});

	const [deleted] = await db
		.delete(product)
		.where(
			and(
				eq(product.id, productId),
				eq(product.sellerProfileId, sellerProfileId),
			),
		)
		.returning();

	if (!deleted) throw new ServiceError(404, "Product not found");

	// Clean up S3 files (best-effort, product already deleted from DB)
	await Promise.allSettled(images.map((img) => s3.delete(img.key)));

	return deleted;
}
