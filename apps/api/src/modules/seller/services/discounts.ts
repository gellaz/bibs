import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	sql,
} from "drizzle-orm";
import { db } from "@/db";
import { discount, discountProduct } from "@/db/schemas/discount";
import { product } from "@/db/schemas/product";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface CreateDiscountParams {
	sellerProfileId: string;
	title: string;
	percent: number;
	startsAt: Date;
	endsAt: Date | null;
}

export async function createDiscount(params: CreateDiscountParams) {
	const [row] = await db
		.insert(discount)
		.values({
			sellerProfileId: params.sellerProfileId,
			title: params.title.trim(),
			percent: params.percent,
			startsAt: params.startsAt,
			endsAt: params.endsAt,
		})
		.returning();
	return row;
}

export interface UpdateDiscountPatch {
	title?: string;
	percent?: number;
	startsAt?: Date;
	endsAt?: Date | null;
}

interface UpdateDiscountParams {
	discountId: string;
	sellerProfileId: string;
	patch: UpdateDiscountPatch;
}

export async function updateDiscount(params: UpdateDiscountParams) {
	const existing = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!existing) throw new ServiceError(404, "Promozione non trovata");

	const isStarted = new Date() >= existing.startsAt;
	const patch = params.patch;

	if (isStarted) {
		if (patch.percent !== undefined && patch.percent !== existing.percent) {
			throw new ServiceError(
				409,
				"Promo già iniziata: percentuale non modificabile",
			);
		}
		if (
			patch.startsAt !== undefined &&
			patch.startsAt.getTime() !== existing.startsAt.getTime()
		) {
			throw new ServiceError(
				409,
				"Promo già iniziata: data di inizio non modificabile",
			);
		}
	}

	if (patch.endsAt !== undefined && patch.endsAt !== null) {
		if (patch.endsAt.getTime() <= Date.now()) {
			throw new ServiceError(409, "La data di fine deve essere futura");
		}
	}

	const updateValues: Partial<typeof discount.$inferInsert> = {};
	if (patch.title !== undefined) updateValues.title = patch.title.trim();
	if (patch.percent !== undefined) updateValues.percent = patch.percent;
	if (patch.startsAt !== undefined) updateValues.startsAt = patch.startsAt;
	if (patch.endsAt !== undefined) updateValues.endsAt = patch.endsAt;

	if (Object.keys(updateValues).length === 0) return existing;

	const [updated] = await db
		.update(discount)
		.set(updateValues)
		.where(eq(discount.id, params.discountId))
		.returning();

	return updated;
}

interface SimpleByIdParams {
	discountId: string;
	sellerProfileId: string;
}

export async function pauseDiscount(params: SimpleByIdParams) {
	const existing = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!existing) throw new ServiceError(404, "Promozione non trovata");
	if (existing.status === "archived") {
		throw new ServiceError(
			409,
			"Promozione archiviata: non può essere ripresa",
		);
	}
	const nextStatus = existing.status === "active" ? "paused" : "active";
	const [out] = await db
		.update(discount)
		.set({ status: nextStatus })
		.where(eq(discount.id, params.discountId))
		.returning();
	return out;
}

export async function archiveDiscount(params: SimpleByIdParams) {
	const existing = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!existing) throw new ServiceError(404, "Promozione non trovata");
	if (existing.status === "archived") {
		throw new ServiceError(409, "Promozione già archiviata");
	}
	const [out] = await db
		.update(discount)
		.set({ status: "archived" })
		.where(eq(discount.id, params.discountId))
		.returning();
	return out;
}

interface AddProductsParams {
	discountId: string;
	sellerProfileId: string;
	productIds: string[];
}

interface AddProductsResult {
	added: number;
	alreadyPresent: number;
	rejected: string[];
}

export async function addProductsToDiscount(
	params: AddProductsParams,
): Promise<AddProductsResult> {
	// Discount ownership check
	const d = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!d) throw new ServiceError(404, "Promozione non trovata");

	if (params.productIds.length === 0) {
		return { added: 0, alreadyPresent: 0, rejected: [] };
	}

	// Filter products owned by the same seller
	const owned = await db
		.select({ id: product.id })
		.from(product)
		.where(
			and(
				inArray(product.id, params.productIds),
				eq(product.sellerProfileId, params.sellerProfileId),
			),
		);
	const ownedIds = new Set(owned.map((p) => p.id));
	const rejected = params.productIds.filter((id) => !ownedIds.has(id));
	const toInsert = params.productIds.filter((id) => ownedIds.has(id));

	if (toInsert.length === 0) {
		return { added: 0, alreadyPresent: 0, rejected };
	}

	// Detect already-present for accurate counts
	const existing = await db
		.select({ productId: discountProduct.productId })
		.from(discountProduct)
		.where(
			and(
				eq(discountProduct.discountId, params.discountId),
				inArray(discountProduct.productId, toInsert),
			),
		);
	const existingIds = new Set(existing.map((e) => e.productId));
	const newIds = toInsert.filter((id) => !existingIds.has(id));

	if (newIds.length > 0) {
		await db
			.insert(discountProduct)
			.values(
				newIds.map((productId) => ({
					discountId: params.discountId,
					productId,
				})),
			)
			.onConflictDoNothing();
	}

	return {
		added: newIds.length,
		alreadyPresent: existingIds.size,
		rejected,
	};
}

interface RemoveProductsParams {
	discountId: string;
	sellerProfileId: string;
	productIds: string[];
}

export async function removeProductsFromDiscount(params: RemoveProductsParams) {
	const d = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!d) throw new ServiceError(404, "Promozione non trovata");

	if (params.productIds.length === 0) return { removed: 0 };

	const deleted = await db
		.delete(discountProduct)
		.where(
			and(
				eq(discountProduct.discountId, params.discountId),
				inArray(discountProduct.productId, params.productIds),
			),
		)
		.returning({ productId: discountProduct.productId });

	return { removed: deleted.length };
}

// ── List / Get / GetProducts ──────────────────────────────────────────────────

export type DiscountOperationalState = "assignable" | "concluded";

interface ListDiscountsParams {
	sellerProfileId: string;
	page?: number;
	limit?: number;
	state?: DiscountOperationalState;
	search?: string;
}

export async function listDiscounts(params: ListDiscountsParams) {
	const { page, limit, offset } = parsePagination(params);
	const state = params.state ?? "assignable";
	const now = new Date();

	const whereParts: ReturnType<typeof eq>[] = [
		eq(discount.sellerProfileId, params.sellerProfileId),
	];

	switch (state) {
		case "concluded":
			// Archived, or active-but-past its end date.
			whereParts.push(
				or(
					eq(discount.status, "archived"),
					and(
						eq(discount.status, "active"),
						isNotNull(discount.endsAt),
						lt(discount.endsAt, now),
					),
				)!,
			);
			break;
		default:
			// "assignable": paused, or active and not yet ended (running + scheduled).
			whereParts.push(
				or(
					eq(discount.status, "paused"),
					and(
						eq(discount.status, "active"),
						or(isNull(discount.endsAt), gte(discount.endsAt, now)),
					),
				)!,
			);
			break;
	}

	if (params.search) {
		whereParts.push(sql`${discount.title} ILIKE ${`%${params.search}%`}`);
	}

	const where = and(...whereParts);

	const rows = await db
		.select({
			d: discount,
			productCount: sql<number>`(SELECT count(*)::int FROM ${discountProduct} WHERE ${discountProduct.discountId} = ${discount.id})`,
		})
		.from(discount)
		.where(where)
		.orderBy(desc(discount.startsAt))
		.limit(limit)
		.offset(offset);

	const [{ total }] = await db
		.select({ total: count() })
		.from(discount)
		.where(where);

	return {
		data: rows.map((r) => ({ ...r.d, productCount: r.productCount })),
		pagination: { page, limit, total },
	};
}

interface ByIdParams {
	discountId: string;
	sellerProfileId: string;
}

export async function getDiscountById(params: ByIdParams) {
	const d = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!d) throw new ServiceError(404, "Promozione non trovata");

	const [{ c }] = await db
		.select({ c: count() })
		.from(discountProduct)
		.where(eq(discountProduct.discountId, params.discountId));

	return { ...d, productCount: c };
}

interface GetDiscountProductsParams extends ByIdParams {
	page?: number;
	limit?: number;
}

export async function getDiscountProducts(params: GetDiscountProductsParams) {
	const d = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
		columns: { id: true, percent: true },
	});
	if (!d) throw new ServiceError(404, "Promozione non trovata");

	const { page, limit, offset } = parsePagination(params);

	const rows = await db
		.select({
			id: product.id,
			name: product.name,
			originalPrice: product.price,
			brandId: product.brandId,
			discountedPrice: sql<string>`ROUND(${product.price} * (1 - ${d.percent}::numeric / 100), 2)::text`,
		})
		.from(product)
		.innerJoin(discountProduct, eq(discountProduct.productId, product.id))
		.where(eq(discountProduct.discountId, d.id))
		.orderBy(discountProduct.addedAt)
		.limit(limit)
		.offset(offset);

	const [{ total }] = await db
		.select({ total: count() })
		.from(discountProduct)
		.where(eq(discountProduct.discountId, d.id));

	return {
		data: rows,
		pagination: { page, limit, total },
	};
}
