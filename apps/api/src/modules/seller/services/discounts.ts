import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { discount } from "@/db/schemas/discount";
import { ServiceError } from "@/lib/errors";

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
