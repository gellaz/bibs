import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/schemas/organization";
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
			where: eq(sellerProfile.onboardingStatus, "pending_review"),
			with: { user: true, organization: true },
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(sellerProfile)
			.where(eq(sellerProfile.onboardingStatus, "pending_review")),
	]);

	return { data, pagination: { page, limit, total } };
}

export async function verifySeller(sellerId: string) {
	const [updated] = await db.transaction(async (tx) => {
		await tx
			.update(organization)
			.set({ vatStatus: "verified" })
			.where(eq(organization.sellerProfileId, sellerId));

		return tx
			.update(sellerProfile)
			.set({ onboardingStatus: "active" })
			.where(eq(sellerProfile.id, sellerId))
			.returning();
	});

	if (!updated) throw new ServiceError(404, "Seller profile not found");
	return updated;
}

export async function rejectSeller(sellerId: string) {
	const [updated] = await db.transaction(async (tx) => {
		await tx
			.update(organization)
			.set({ vatStatus: "rejected" })
			.where(eq(organization.sellerProfileId, sellerId));

		return tx
			.update(sellerProfile)
			.set({ onboardingStatus: "rejected" })
			.where(eq(sellerProfile.id, sellerId))
			.returning();
	});

	if (!updated) throw new ServiceError(404, "Seller profile not found");
	return updated;
}
