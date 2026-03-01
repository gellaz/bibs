import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface ListPendingSellersParams {
	page?: number;
	limit?: number;
}

export async function listPendingSellers(params: ListPendingSellersParams) {
	const { page, limit, offset } = parsePagination(params);

	const [data, [{ total }]] = await Promise.all([
		db.query.sellerProfile.findMany({
			where: eq(sellerProfile.vatStatus, "pending"),
			with: { user: true },
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(sellerProfile)
			.where(eq(sellerProfile.vatStatus, "pending")),
	]);

	return { data, pagination: { page, limit, total } };
}

export async function verifySeller(sellerId: string) {
	const [updated] = await db
		.update(sellerProfile)
		.set({ vatStatus: "verified" })
		.where(eq(sellerProfile.id, sellerId))
		.returning();

	if (!updated) throw new ServiceError(404, "Seller profile not found");
	return updated;
}

export async function rejectSeller(sellerId: string) {
	const [updated] = await db
		.update(sellerProfile)
		.set({ vatStatus: "rejected" })
		.where(eq(sellerProfile.id, sellerId))
		.returning();

	if (!updated) throw new ServiceError(404, "Seller profile not found");
	return updated;
}
