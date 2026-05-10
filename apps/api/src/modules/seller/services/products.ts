import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { brand } from "@/db/schemas/brand";
import { productCategory } from "@/db/schemas/category";
import {
	type ProductStatus,
	product,
	productCategoryAssignment,
	storeProduct,
} from "@/db/schemas/product";
import type { ProductAuditAction } from "@/db/schemas/product-audit-log";
import { productImage } from "@/db/schemas/product-image";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";
import { s3 } from "@/lib/s3";
import { recordProductAudit, recordProductAuditBatch } from "./product-audit";

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
	storeId: string;
	page?: number;
	limit?: number;
	statusFilter?: ProductStatus;
}

export async function listProducts(params: ListProductsParams) {
	const { sellerProfileId, storeId, statusFilter = "active" } = params;
	const { page, limit, offset } = parsePagination(params);

	const storeCondition = and(
		eq(product.sellerProfileId, sellerProfileId),
		eq(storeProduct.storeId, storeId),
		eq(product.status, statusFilter),
	);

	// Get the IDs of products available in this store, paginated.
	const productIdsRows = await db
		.select({ id: product.id })
		.from(product)
		.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
		.where(storeCondition)
		.limit(limit)
		.offset(offset);

	const productIds = productIdsRows.map((r) => r.id);

	// Total count
	const [{ total }] = await db
		.select({ total: count() })
		.from(product)
		.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
		.where(storeCondition);

	// Fetch full products with relations using the page's product IDs.
	const data =
		productIds.length === 0
			? []
			: await db.query.product.findMany({
					where: inArray(product.id, productIds),
					with: {
						productCategoryAssignments: { with: { category: true } },
						storeProducts: {
							with: { store: { columns: { location: false } } },
						},
						images: { orderBy: (img, { asc }) => [asc(img.position)] },
						brand: true,
					},
				});

	// Sort data to preserve the order from productIds (the JOIN-paginated order).
	const order = new Map(productIds.map((id, idx) => [id, idx]));
	data.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

	return { data, pagination: { page, limit, total } };
}

// ── getProductStatusCounts ────────────────────────────────────────────────────

interface GetCountsParams {
	sellerProfileId: string;
	storeId: string;
}

export async function getProductStatusCounts(
	params: GetCountsParams,
): Promise<Record<ProductStatus, number>> {
	const { sellerProfileId, storeId } = params;

	const rows = await db
		.select({
			status: product.status,
			count: count(),
		})
		.from(product)
		.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
		.where(
			and(
				eq(product.sellerProfileId, sellerProfileId),
				eq(storeProduct.storeId, storeId),
			),
		)
		.groupBy(product.status);

	const result: Record<ProductStatus, number> = {
		active: 0,
		disabled: 0,
		trashed: 0,
	};
	for (const r of rows) {
		result[r.status as ProductStatus] = Number(r.count);
	}
	return result;
}

// ── getProduct ────────────────────────────────────────────────────────────────

interface GetProductParams {
	productId: string;
	sellerProfileId: string;
	accessibleStoreIds: string[];
}

export async function getProduct(params: GetProductParams) {
	const { productId, sellerProfileId, accessibleStoreIds } = params;

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

	// Verify accessibility: at least one storeProducts row must be in accessibleStoreIds
	const accessible = found.storeProducts.some((sp) =>
		accessibleStoreIds.includes(sp.storeId),
	);
	if (!accessible) throw new ServiceError(404, "Product not found");

	return found;
}

// ── createProduct ─────────────────────────────────────────────────────────────

interface CreateProductParams {
	sellerProfileId: string;
	storeId: string;
	name: string;
	description?: string;
	price: string;
	categoryIds?: string[];
	ean?: string;
	brandId?: string;
	brandName?: string;
}

export async function createProduct(params: CreateProductParams) {
	const {
		sellerProfileId,
		storeId,
		categoryIds = [],
		brandId,
		brandName,
		ean,
		...productData
	} = params;

	// Validate: if multiple categories given, all belong to one macro
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

	const normalizedEan = ean && ean.length > 0 ? ean : null;

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
				ean: normalizedEan,
				brandId: resolvedBrandId,
			})
			.returning();

		// Auto-assign to the active store with stock=0.
		await tx.insert(storeProduct).values({
			productId: created.id,
			storeId,
			stock: 0,
		});

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
	accessibleStoreIds: string[];
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
		accessibleStoreIds,
		categoryIds,
		imageOrder,
		ean,
		brandId,
		brandName,
		...productData
	} = params;

	// Verify accessibility before mutating
	const existing = await db.query.product.findFirst({
		where: and(
			eq(product.id, productId),
			eq(product.sellerProfileId, sellerProfileId),
		),
		with: { storeProducts: { columns: { storeId: true } } },
	});
	if (!existing) return null;
	const accessible = existing.storeProducts.some((sp) =>
		accessibleStoreIds.includes(sp.storeId),
	);
	if (!accessible) return null;

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

		if (ean !== undefined) {
			productUpdates.ean = ean === null || ean.length === 0 ? null : ean;
		}

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
	accessibleStoreIds: string[];
}

export async function deleteProduct(params: DeleteProductParams) {
	const { productId, sellerProfileId, accessibleStoreIds } = params;

	// Verify accessibility before mutating
	const check = await db.query.product.findFirst({
		where: and(
			eq(product.id, productId),
			eq(product.sellerProfileId, sellerProfileId),
		),
		with: { storeProducts: { columns: { storeId: true } } },
	});
	if (!check) throw new ServiceError(404, "Product not found");
	const accessible = check.storeProducts.some((sp) =>
		accessibleStoreIds.includes(sp.storeId),
	);
	if (!accessible) throw new ServiceError(404, "Product not found");

	if (check.status !== "trashed") {
		throw new ServiceError(409, "Sposta prima il prodotto nel cestino");
	}

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

// ── updateProductStatus ───────────────────────────────────────────────────────

interface UpdateProductStatusParams {
	productId: string;
	sellerProfileId: string;
	accessibleStoreIds: string[];
	actorUserId: string;
	status: ProductStatus;
}

function deriveAuditAction(
	previous: ProductStatus,
	next: ProductStatus,
): ProductAuditAction {
	if (next === "trashed") return "trashed";
	if (previous === "trashed") return "restored";
	if (next === "disabled") return "disabled";
	return "enabled";
}

export async function updateProductStatus(params: UpdateProductStatusParams) {
	const {
		productId,
		sellerProfileId,
		accessibleStoreIds,
		actorUserId,
		status,
	} = params;

	const found = await db.query.product.findFirst({
		where: and(
			eq(product.id, productId),
			eq(product.sellerProfileId, sellerProfileId),
		),
		with: { storeProducts: { columns: { storeId: true } } },
	});
	if (!found) throw new ServiceError(404, "Product not found");

	const accessible = found.storeProducts.some((sp) =>
		accessibleStoreIds.includes(sp.storeId),
	);
	if (!accessible) throw new ServiceError(404, "Product not found");

	if (found.status === status) return found;

	return db.transaction(async (tx) => {
		const [updated] = await tx
			.update(product)
			.set({ status, updatedAt: new Date() })
			.where(eq(product.id, productId))
			.returning();

		const action = deriveAuditAction(found.status, status);
		await recordProductAudit(
			{
				productId,
				actorUserId,
				action,
				metadata:
					action === "restored"
						? { previousStatus: found.status, newStatus: status }
						: undefined,
			},
			tx,
		);

		return updated;
	});
}

// ── bulkUpdateProductStatus ───────────────────────────────────────────────────

interface BulkUpdateParams {
	sellerProfileId: string;
	accessibleStoreIds: string[];
	actorUserId: string;
	productIds: string[];
	status: ProductStatus;
}

interface BulkResult {
	succeeded: string[];
	failed: { productId: string; reason: "not_found" | "no_access" }[];
}

export async function bulkUpdateProductStatus(
	params: BulkUpdateParams,
): Promise<BulkResult> {
	const {
		sellerProfileId,
		accessibleStoreIds,
		actorUserId,
		productIds,
		status,
	} = params;

	if (productIds.length === 0) return { succeeded: [], failed: [] };

	return db.transaction(async (tx) => {
		// 1. Carica i prodotti del seller con relativi storeIds
		const ownedRows = await tx
			.select({
				id: product.id,
				status: product.status,
				storeId: storeProduct.storeId,
			})
			.from(product)
			.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
			.where(
				and(
					inArray(product.id, productIds),
					eq(product.sellerProfileId, sellerProfileId),
				),
			);

		// 2. Determina ownership / accessibility
		const ownedIds = new Set<string>();
		const accessibleIds = new Set<string>();
		const previousStatusByProduct = new Map<string, ProductStatus>();
		for (const r of ownedRows) {
			ownedIds.add(r.id);
			previousStatusByProduct.set(r.id, r.status as ProductStatus);
			if (accessibleStoreIds.includes(r.storeId)) accessibleIds.add(r.id);
		}

		const failed: BulkResult["failed"] = [];
		const accessibleArr: string[] = [];
		for (const id of productIds) {
			if (!ownedIds.has(id)) {
				failed.push({ productId: id, reason: "not_found" });
			} else if (!accessibleIds.has(id)) {
				failed.push({ productId: id, reason: "no_access" });
			} else {
				accessibleArr.push(id);
			}
		}

		// 3. Filter to those whose status actually changes
		const toUpdate = accessibleArr.filter(
			(id) => previousStatusByProduct.get(id) !== status,
		);

		if (toUpdate.length > 0) {
			await tx
				.update(product)
				.set({ status, updatedAt: new Date() })
				.where(inArray(product.id, toUpdate));

			// 4. Audit batch
			const entries = toUpdate.map((id) => {
				const prev = previousStatusByProduct.get(id) as ProductStatus;
				const action = deriveAuditAction(prev, status);
				return {
					productId: id,
					actorUserId,
					action,
					metadata:
						action === "restored"
							? { previousStatus: prev, newStatus: status }
							: undefined,
				};
			});
			await recordProductAuditBatch(entries, tx);
		}

		return { succeeded: accessibleArr, failed };
	});
}

// ── bulkDeletePermanent ───────────────────────────────────────────────────────

interface BulkDeleteParams {
	sellerProfileId: string;
	accessibleStoreIds: string[];
	productIds: string[];
}

interface BulkDeleteResult {
	succeeded: string[];
	failed: {
		productId: string;
		reason: "not_found" | "no_access" | "not_in_trash";
	}[];
}

export async function bulkDeletePermanent(
	params: BulkDeleteParams,
): Promise<BulkDeleteResult> {
	const { sellerProfileId, accessibleStoreIds, productIds } = params;

	if (productIds.length === 0) return { succeeded: [], failed: [] };

	// Categorize ownership and trashed-ness BEFORE the transaction
	const ownedRows = await db
		.select({
			id: product.id,
			status: product.status,
			storeId: storeProduct.storeId,
		})
		.from(product)
		.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
		.where(
			and(
				inArray(product.id, productIds),
				eq(product.sellerProfileId, sellerProfileId),
			),
		);

	const ownedIds = new Set<string>();
	const accessibleIds = new Set<string>();
	const trashedIds = new Set<string>();
	for (const r of ownedRows) {
		ownedIds.add(r.id);
		if (accessibleStoreIds.includes(r.storeId)) accessibleIds.add(r.id);
		if (r.status === "trashed") trashedIds.add(r.id);
	}

	const failed: BulkDeleteResult["failed"] = [];
	const toDelete: string[] = [];
	for (const id of productIds) {
		if (!ownedIds.has(id)) {
			failed.push({ productId: id, reason: "not_found" });
		} else if (!accessibleIds.has(id)) {
			failed.push({ productId: id, reason: "no_access" });
		} else if (!trashedIds.has(id)) {
			failed.push({ productId: id, reason: "not_in_trash" });
		} else {
			toDelete.push(id);
		}
	}

	if (toDelete.length === 0) return { succeeded: [], failed };

	// Fetch S3 keys before delete
	const images = await db
		.select({ key: productImage.key })
		.from(productImage)
		.where(inArray(productImage.productId, toDelete));

	await db.transaction(async (tx) => {
		await tx.delete(product).where(inArray(product.id, toDelete));
	});

	// Best-effort S3 cleanup outside transaction
	await Promise.allSettled(images.map((img) => s3.delete(img.key)));

	return { succeeded: toDelete, failed };
}
