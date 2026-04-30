import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { brand } from "@/db/schemas/brand";
import { productCategory } from "@/db/schemas/category";
import { product, productCategoryAssignment } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";
import { s3 } from "@/lib/s3";

// ── Brand resolution helper ───────────────────────────────────────────────────
//
// Uses tx.execute(sql`...`) so the INSERT runs inside the Drizzle transaction.
// The functional unique index on (seller_profile_id, lower(name)) ensures
// case-insensitive idempotency without Drizzle's onConflictDoUpdate (which
// cannot target functional/expression indexes).

async function findOrCreateBrandInTx(
	tx: PgTransaction<any, any, any>,
	sellerProfileId: string,
	name: string,
): Promise<string> {
	const trimmed = name.trim();
	const result = await tx.execute<{ id: string }>(
		sql`INSERT INTO brands (id, seller_profile_id, name)
		     VALUES (gen_random_uuid()::text, ${sellerProfileId}, ${trimmed})
		     ON CONFLICT (seller_profile_id, lower(name))
		     DO UPDATE SET updated_at = now()
		     RETURNING id`,
	);
	const row = (result as unknown as { rows: { id: string }[] }).rows[0];
	return row.id;
}

// ── listProducts ──────────────────────────────────────────────────────────────

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
				productCategoryAssignments: { with: { category: true } },
				storeProducts: { with: { store: { columns: { location: false } } } },
				images: { orderBy: (img, { asc }) => [asc(img.position)] },
				brand: true,
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

// ── getProduct ────────────────────────────────────────────────────────────────

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
			productCategoryAssignments: { with: { category: true } },
			storeProducts: { with: { store: { columns: { location: false } } } },
			images: { orderBy: (img, { asc }) => [asc(img.position)] },
			brand: true,
		},
	});

	if (!found) throw new ServiceError(404, "Product not found");
	return found;
}

// ── createProduct ─────────────────────────────────────────────────────────────

interface CreateProductParams {
	sellerProfileId: string;
	name: string;
	description?: string;
	price: string;
	categoryIds: string[];
	ean?: string;
	brandId?: string;
	brandName?: string;
}

export async function createProduct(params: CreateProductParams) {
	const {
		sellerProfileId,
		categoryIds,
		brandId,
		brandName,
		ean,
		...productData
	} = params;

	// Validate: all categoryIds belong to a single macro-category
	if (categoryIds.length > 1) {
		const macros = await db
			.selectDistinct({ macroId: productCategory.macroCategoryId })
			.from(productCategory)
			.where(inArray(productCategory.id, categoryIds));
		if (macros.length > 1) {
			throw new ServiceError(
				400,
				"Le categorie devono appartenere a una sola macro-categoria",
			);
		}
	}

	return db.transaction(async (tx) => {
		// Resolve brand: brandId wins over brandName
		let resolvedBrandId: string | null = null;
		if (brandId) {
			const owned = await tx.query.brand.findFirst({
				where: and(
					eq(brand.id, brandId),
					eq(brand.sellerProfileId, sellerProfileId),
				),
			});
			if (!owned) throw new ServiceError(404, "Brand not found");
			resolvedBrandId = owned.id;
		} else if (brandName) {
			resolvedBrandId = await findOrCreateBrandInTx(
				tx,
				sellerProfileId,
				brandName,
			);
		}

		const [created] = await tx
			.insert(product)
			.values({
				sellerProfileId,
				...productData,
				ean: ean ?? null,
				brandId: resolvedBrandId,
			})
			.returning();

		if (categoryIds.length > 0) {
			await tx.insert(productCategoryAssignment).values(
				categoryIds.map((categoryId) => ({
					productId: created.id,
					productCategoryId: categoryId,
				})),
			);
		}

		return created;
	});
}

// ── updateProduct ─────────────────────────────────────────────────────────────

interface UpdateProductParams {
	productId: string;
	sellerProfileId: string;
	categoryIds?: string[];
	imageOrder?: string[];
	name?: string;
	description?: string;
	price?: string;
	ean?: string | null;
	brandId?: string | null;
	brandName?: string;
}

export async function updateProduct(params: UpdateProductParams) {
	const {
		productId,
		sellerProfileId,
		categoryIds,
		imageOrder,
		ean,
		brandId,
		brandName,
		...productData
	} = params;

	// Validate: all categoryIds belong to a single macro-category
	if (categoryIds && categoryIds.length > 1) {
		const macros = await db
			.selectDistinct({ macroId: productCategory.macroCategoryId })
			.from(productCategory)
			.where(inArray(productCategory.id, categoryIds));
		if (macros.length > 1) {
			throw new ServiceError(
				400,
				"Le categorie devono appartenere a una sola macro-categoria",
			);
		}
	}

	return db.transaction(async (tx) => {
		// Build product update payload including optional ean/brandId fields
		const productUpdates: Record<string, unknown> = { ...productData };

		if (ean !== undefined) productUpdates.ean = ean;

		if (brandId !== undefined) {
			if (brandId === null) {
				productUpdates.brandId = null;
			} else {
				const owned = await tx.query.brand.findFirst({
					where: and(
						eq(brand.id, brandId),
						eq(brand.sellerProfileId, sellerProfileId),
					),
				});
				if (!owned) throw new ServiceError(404, "Brand not found");
				productUpdates.brandId = owned.id;
			}
		} else if (brandName) {
			productUpdates.brandId = await findOrCreateBrandInTx(
				tx,
				sellerProfileId,
				brandName,
			);
		}

		// Only issue the UPDATE if there are plain product columns to change.
		// With only categoryIds/imageOrder we'd call .set({}) and Drizzle throws
		// "No values to set" — fetch the row instead so the caller still gets it.
		const hasProductData = Object.keys(productUpdates).length > 0;

		const [updated] = hasProductData
			? await tx
					.update(product)
					.set(productUpdates)
					.where(
						and(
							eq(product.id, productId),
							eq(product.sellerProfileId, sellerProfileId),
						),
					)
					.returning()
			: await tx
					.select()
					.from(product)
					.where(
						and(
							eq(product.id, productId),
							eq(product.sellerProfileId, sellerProfileId),
						),
					);

		if (!updated) return null;

		if (categoryIds) {
			await tx
				.delete(productCategoryAssignment)
				.where(eq(productCategoryAssignment.productId, updated.id));

			if (categoryIds.length > 0) {
				await tx.insert(productCategoryAssignment).values(
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

// ── deleteProduct ─────────────────────────────────────────────────────────────

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

// ── lookupProductByEan ────────────────────────────────────────────────────────

interface LookupProductByEanParams {
	ean: string;
}

export interface EanLookupResult {
	name: string;
	description: string | null;
	ean: string;
	brandName: string | null;
	macroCategoryId: string | null;
	categoryIds: string[];
}

export async function lookupProductByEan(
	params: LookupProductByEanParams,
): Promise<EanLookupResult | null> {
	const { ean } = params;

	const row = await db.query.product.findFirst({
		where: eq(product.ean, ean),
		orderBy: [desc(product.createdAt)],
		with: {
			brand: true,
			productCategoryAssignments: {
				with: { category: true },
			},
		},
	});

	if (!row) return null;

	const categoryIds = row.productCategoryAssignments.map(
		(a) => a.productCategoryId,
	);
	const macroCategoryId =
		row.productCategoryAssignments[0]?.category.macroCategoryId ?? null;

	return {
		name: row.name,
		description: row.description ?? null,
		ean: row.ean!,
		brandName: row.brand?.name ?? null,
		macroCategoryId,
		categoryIds,
	};
}
