import { db } from "@/db";
import { discount } from "@/db/schemas/discount";

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
