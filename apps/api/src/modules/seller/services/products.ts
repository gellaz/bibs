import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
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
import { isUniqueViolation, ServiceError } from "@/lib/errors";
import {
	municipalityCompactWith,
	toMunicipalityCompact,
} from "@/lib/municipality";
import { parsePagination } from "@/lib/pagination";
import { s3 } from "@/lib/s3";
import type { VatRate } from "@/lib/vat";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";
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
//
// Sanitizza un termine di ricerca libero in un'espressione `to_tsquery`
// con prefix matching su ogni token. Ritorna `null` se la query effettiva
// (dopo trimming e rimozione di caratteri non alfanumerici/whitespace)
// produce zero token utili, così il caller può saltare il branch full-text.
//
// Esempio:
//   "Lava Bosch"  →  "lava:* & bosch:*"
//   "'; DROP--"   →  "drop:*"
//   ""            →  null
//   "a"           →  null   (minimo 2 char effettivi)
function buildPrefixTsquery(raw: string): string | null {
	const trimmed = raw.trim();
	if (trimmed.length < 2) return null;
	const tokens = trimmed
		.toLowerCase()
		.split(/\s+/)
		.map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ""))
		.filter((t) => t.length > 0);
	if (tokens.length === 0) return null;
	return tokens.map((t) => `${t}:*`).join(" & ");
}

export type ProductSortField =
	| "name"
	| "price"
	| "ean"
	| "stock"
	| "createdAt"
	| "updatedAt";
export type SortOrder = "asc" | "desc";

interface ListProductsParams {
	sellerProfileId: string;
	storeId?: string;
	/**
	 * When set (employee callers without an explicit storeId), restricts the
	 * result to products stocked in one of these stores. An empty array means
	 * "no accessible stores" → no products. Ignored when `storeId` is provided
	 * (that path is already store-scoped via the join + ensureStoreAccess).
	 */
	restrictToStoreIds?: string[];
	page?: number;
	limit?: number;
	statusFilter?: ProductStatus;
	brandId?: string;
	productCategoryIds?: string[];
	productMacroCategoryId?: string;
	minPrice?: string;
	maxPrice?: string;
	inStock?: boolean;
	excludeDiscountId?: string;
	q?: string;
	sort?: ProductSortField;
	order?: SortOrder;
}

export async function listProducts(params: ListProductsParams) {
	const {
		sellerProfileId,
		storeId,
		restrictToStoreIds,
		statusFilter = "active",
		brandId,
		productCategoryIds,
		productMacroCategoryId,
		minPrice,
		maxPrice,
		inStock,
		excludeDiscountId,
		q,
		sort,
		order = "desc",
	} = params;
	const { page, limit, offset } = parsePagination(params);

	const conditions = [
		eq(product.sellerProfileId, sellerProfileId),
		eq(product.status, statusFilter),
	];

	if (brandId) conditions.push(eq(product.brandId, brandId));
	if (minPrice) conditions.push(sql`${product.price} >= ${minPrice}::numeric`);
	if (maxPrice) conditions.push(sql`${product.price} <= ${maxPrice}::numeric`);

	if (storeId) {
		conditions.push(eq(storeProduct.storeId, storeId));
	} else if (restrictToStoreIds) {
		// Employee seller-wide view: limit to products stocked in an accessible store.
		if (restrictToStoreIds.length === 0) {
			conditions.push(sql`false`);
		} else {
			const storeIdList = sql.join(
				restrictToStoreIds.map((id) => sql`${id}`),
				sql`, `,
			);
			conditions.push(
				sql`EXISTS (SELECT 1 FROM store_products sp WHERE sp.product_id = ${product.id} AND sp.store_id IN (${storeIdList}))`,
			);
		}
	}

	if (inStock) {
		// inStock must reflect the SAME store scope as the rest of the query:
		// otherwise a product out of stock in the queried store still passes
		// because it has stock in some other (possibly inaccessible) store.
		if (storeId) {
			conditions.push(
				sql`EXISTS (SELECT 1 FROM store_products sp WHERE sp.product_id = ${product.id} AND sp.store_id = ${storeId} AND sp.stock > 0)`,
			);
		} else if (restrictToStoreIds && restrictToStoreIds.length > 0) {
			const storeIdList = sql.join(
				restrictToStoreIds.map((id) => sql`${id}`),
				sql`, `,
			);
			conditions.push(
				sql`EXISTS (SELECT 1 FROM store_products sp WHERE sp.product_id = ${product.id} AND sp.store_id IN (${storeIdList}) AND sp.stock > 0)`,
			);
		} else {
			conditions.push(
				sql`EXISTS (SELECT 1 FROM store_products sp WHERE sp.product_id = ${product.id} AND sp.stock > 0)`,
			);
		}
	}

	if (productCategoryIds && productCategoryIds.length > 0) {
		const idList = sql.join(
			productCategoryIds.map((id) => sql`${id}`),
			sql`, `,
		);
		conditions.push(
			sql`EXISTS (SELECT 1 FROM product_category_assignments pca WHERE pca.product_id = ${product.id} AND pca.product_category_id IN (${idList}))`,
		);
	}

	if (productMacroCategoryId) {
		conditions.push(
			sql`EXISTS (SELECT 1 FROM product_category_assignments pca JOIN product_categories pc ON pc.id = pca.product_category_id WHERE pca.product_id = ${product.id} AND pc.macro_category_id = ${productMacroCategoryId})`,
		);
	}

	if (excludeDiscountId) {
		conditions.push(
			sql`NOT EXISTS (SELECT 1 FROM discount_products dp WHERE dp.product_id = ${product.id} AND dp.discount_id = ${excludeDiscountId})`,
		);
	}

	// Ricerca testuale avanzata: tsvector con prefix matching (italian) +
	// trigram similarity (typo tolerance) + EAN exact + brand-name fuzzy.
	// L'OR sfrutta gli indici GIN: product_search_idx, product_name_trgm_idx,
	// product_ean_idx, brands_name_trgm_idx.
	const tsquery = q ? buildPrefixTsquery(q) : null;
	const qTrimmed = q?.trim() ?? "";
	const searchActive = tsquery !== null;
	if (searchActive) {
		const orClause = or(
			sql`(
        setweight(to_tsvector('italian', ${product.name}), 'A') ||
        setweight(to_tsvector('italian', coalesce(${product.description}, '')), 'B')
      ) @@ to_tsquery('italian', ${tsquery})`,
			sql`similarity(lower(${product.name}), lower(${qTrimmed})) > 0.25`,
			sql`lower(${product.ean}) = lower(${qTrimmed})`,
			sql`EXISTS (
        SELECT 1 FROM brands b
        WHERE b.id = ${product.brandId}
        AND lower(b.name) % lower(${qTrimmed})
      )`,
		);
		if (orClause) conditions.push(orClause);
	}

	const where = and(...conditions);

	// Score combinato: full-text rank (peso 1) + trigram similarity sul name (peso 0.5).
	// Usato per ordinare quando `q` è presente.
	const scoreExpr = searchActive
		? sql<number>`(
        ts_rank_cd(
          setweight(to_tsvector('italian', ${product.name}), 'A') ||
          setweight(to_tsvector('italian', coalesce(${product.description}, '')), 'B'),
          to_tsquery('italian', ${tsquery})
        )
        + 0.5 * similarity(lower(${product.name}), lower(${qTrimmed}))
      )`.as("score")
		: null;

	// Pattern: paginare gli ID dalla baseQuery, poi rifetchare con le relations.
	// Quando c'è ricerca, ordiniamo per score DESC, createdAt DESC.
	let productIds: string[];
	if (searchActive && scoreExpr) {
		const base = storeId
			? db
					.select({ id: product.id, score: scoreExpr })
					.from(product)
					.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
					.where(where)
			: db
					.select({ id: product.id, score: scoreExpr })
					.from(product)
					.where(where);
		const rows = await base
			.orderBy(sql`score DESC`, desc(product.createdAt))
			.limit(limit)
			.offset(offset);
		productIds = rows.map((r) => r.id);
	} else {
		// Server-side sort. EAN is nullable → NULLs always last via IS NULL prefix.
		// createdAt is added as stable tiebreaker (skipped when it's the primary key).
		const dir = order === "asc" ? asc : desc;
		const orderByClauses = (() => {
			switch (sort) {
				case "name":
					return [dir(product.name), desc(product.createdAt)];
				case "price":
					return [dir(product.price), desc(product.createdAt)];
				case "ean":
					return [
						sql`${product.ean} IS NULL`,
						dir(product.ean),
						desc(product.createdAt),
					];
				case "createdAt":
					return [dir(product.createdAt)];
				case "updatedAt":
					return [dir(product.updatedAt), desc(product.createdAt)];
				case "stock":
					if (!storeId) {
						throw new ServiceError(400, "sort=stock requires storeId");
					}
					return [dir(storeProduct.stock), desc(product.createdAt)];
				default:
					return [desc(product.updatedAt), desc(product.createdAt)];
			}
		})();

		const base = storeId
			? db
					.select({ id: product.id })
					.from(product)
					.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
					.where(where)
			: db.select({ id: product.id }).from(product).where(where);
		const rows = await base
			.orderBy(...orderByClauses)
			.limit(limit)
			.offset(offset);
		productIds = rows.map((r) => r.id);
	}

	const countQuery = storeId
		? db
				.select({ total: count() })
				.from(product)
				.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
				.where(where)
		: db.select({ total: count() }).from(product).where(where);

	const [{ total }] = await countQuery;

	// Fetch full products with relations using the page's product IDs.
	const rawData =
		productIds.length === 0
			? []
			: await db.query.product.findMany({
					where: inArray(product.id, productIds),
					with: {
						productCategoryAssignments: {
							with: { category: { with: { macroCategory: true } } },
						},
						storeProducts: {
							with: {
								store: {
									columns: { location: false },
									with: {
										municipality: municipalityCompactWith,
									},
								},
							},
						},
						images: { orderBy: (img, { asc }) => [asc(img.position)] },
						brand: true,
					},
				});

	const data = rawData.map((p) => ({
		...p,
		storeProducts: p.storeProducts.map(({ store, ...sp }) => ({
			...sp,
			store: {
				...store,
				municipality: toMunicipalityCompact(store.municipality),
			},
		})),
	}));

	// Sort data to preserve the order from productIds (the JOIN-paginated order).
	const indexById = new Map(productIds.map((id, idx) => [id, idx]));
	data.sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0));

	const discountMap = await getBestActiveDiscounts(data.map((p) => p.id));
	const annotated = data.map((p) => {
		const d = discountMap.get(p.id);
		return {
			...p,
			appliedDiscount: d
				? {
						percent: d.percent,
						discountedPrice: d.discountedPrice,
						title: d.title,
					}
				: null,
		};
	});

	return { data: annotated, pagination: { page, limit, total } };
}

// ── listCategoriesInUse ───────────────────────────────────────────────────────
//
// Restituisce le sotto-categorie effettivamente assegnate ad almeno un prodotto
// del seller, opzionalmente scopate per store e status. Usato dal filtro UI
// per offrire solo voci che producono risultati > 0.

interface ListCategoriesInUseParams {
	sellerProfileId: string;
	storeId?: string;
	statusFilter?: ProductStatus;
	/** Employee scoping mirror of {@link ListProductsParams.restrictToStoreIds}. */
	restrictToStoreIds?: string[];
}

export async function listCategoriesInUse(params: ListCategoriesInUseParams) {
	const { sellerProfileId, storeId, statusFilter, restrictToStoreIds } = params;

	const conditions = [eq(product.sellerProfileId, sellerProfileId)];
	if (statusFilter) conditions.push(eq(product.status, statusFilter));
	if (storeId) {
		conditions.push(eq(storeProduct.storeId, storeId));
	} else if (restrictToStoreIds) {
		if (restrictToStoreIds.length === 0) return [];
		const storeIdList = sql.join(
			restrictToStoreIds.map((id) => sql`${id}`),
			sql`, `,
		);
		conditions.push(
			sql`EXISTS (SELECT 1 FROM store_products sp WHERE sp.product_id = ${product.id} AND sp.store_id IN (${storeIdList}))`,
		);
	}

	const baseQuery = storeId
		? db
				.selectDistinct({ id: productCategoryAssignment.productCategoryId })
				.from(productCategoryAssignment)
				.innerJoin(product, eq(productCategoryAssignment.productId, product.id))
				.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
				.where(and(...conditions))
		: db
				.selectDistinct({ id: productCategoryAssignment.productCategoryId })
				.from(productCategoryAssignment)
				.innerJoin(product, eq(productCategoryAssignment.productId, product.id))
				.where(and(...conditions));

	const rows = await baseQuery;
	const ids = rows.map((r) => r.id);
	if (ids.length === 0) return [];

	return db.query.productCategory.findMany({
		where: inArray(productCategory.id, ids),
		with: { macroCategory: true },
		orderBy: (pc, { asc }) => [asc(pc.name)],
	});
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

/** True if at least one of the product's store rows is in the accessible set. */
function isProductAccessible(
	storeProducts: { storeId: string }[],
	accessibleStoreIds: string[],
) {
	return storeProducts.some((sp) => accessibleStoreIds.includes(sp.storeId));
}

/**
 * Loads a product owned by the seller AND reachable via one of accessibleStoreIds,
 * throwing 404 otherwise. Minimal (storeId-only) accessibility guard shared by the
 * mutations that throw. getProduct fetches richer relations and updateProduct
 * returns null instead of throwing, so those call isProductAccessible directly.
 */
async function loadAccessibleProduct(
	productId: string,
	sellerProfileId: string,
	accessibleStoreIds: string[],
) {
	const found = await db.query.product.findFirst({
		where: and(
			eq(product.id, productId),
			eq(product.sellerProfileId, sellerProfileId),
		),
		with: { storeProducts: { columns: { storeId: true } } },
	});
	if (!found || !isProductAccessible(found.storeProducts, accessibleStoreIds)) {
		throw new ServiceError(404, "Product not found");
	}
	return found;
}

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
			productCategoryAssignments: {
				with: { category: { with: { macroCategory: true } } },
			},
			storeProducts: {
				with: {
					store: {
						columns: { location: false },
						with: {
							municipality: municipalityCompactWith,
						},
					},
				},
			},
			images: { orderBy: (img, { asc }) => [asc(img.position)] },
			brand: true,
		},
	});

	if (!found) throw new ServiceError(404, "Product not found");
	if (!isProductAccessible(found.storeProducts, accessibleStoreIds)) {
		throw new ServiceError(404, "Product not found");
	}

	return {
		...found,
		storeProducts: found.storeProducts.map(({ store, ...sp }) => ({
			...sp,
			store: {
				...store,
				municipality: toMunicipalityCompact(store.municipality),
			},
		})),
	};
}

// ── createProduct ─────────────────────────────────────────────────────────────

interface CreateProductParams {
	sellerProfileId: string;
	storeId: string;
	name: string;
	description?: string;
	price: string;
	vatRate?: VatRate;
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
	vatRate?: VatRate;
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
	if (!isProductAccessible(existing.storeProducts, accessibleStoreIds)) {
		return null;
	}

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

	const check = await loadAccessibleProduct(
		productId,
		sellerProfileId,
		accessibleStoreIds,
	);

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

	const found = await loadAccessibleProduct(
		productId,
		sellerProfileId,
		accessibleStoreIds,
	);

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
	failed: {
		productId: string;
		reason: "not_found" | "no_access" | "ean_conflict";
	}[];
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

		// 3b. Apply each change in its own savepoint so a single EAN unique
		//     violation (e.g. restoring a trashed product whose EAN is already
		//     held by an active one — trashed rows are excluded from the partial
		//     unique index) isolates to that product instead of aborting the
		//     whole batch.
		const updatedIds: string[] = [];
		for (const id of toUpdate) {
			try {
				await tx.transaction(async (sp) => {
					await sp
						.update(product)
						.set({ status, updatedAt: new Date() })
						.where(eq(product.id, id));
				});
				updatedIds.push(id);
			} catch (err) {
				if (isUniqueViolation(err)) {
					failed.push({ productId: id, reason: "ean_conflict" });
				} else {
					throw err;
				}
			}
		}

		// 4. Audit only the products that were actually updated.
		if (updatedIds.length > 0) {
			const entries = updatedIds.map((id) => {
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

		// succeeded = accessible products minus those that hit an EAN conflict
		// (includes no-op transitions whose status already matched the target).
		const conflicted = new Set(
			failed.filter((f) => f.reason === "ean_conflict").map((f) => f.productId),
		);
		const succeeded = accessibleArr.filter((id) => !conflicted.has(id));

		return { succeeded, failed };
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
