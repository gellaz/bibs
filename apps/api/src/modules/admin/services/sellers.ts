import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { organization } from "@/db/schemas/organization";
import { paymentMethod } from "@/db/schemas/payment-method";
import { type OnboardingStatus, sellerProfile } from "@/db/schemas/seller";
import { sellerProfileChange } from "@/db/schemas/seller-profile-change";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

/** Statuses visible to admins (past onboarding steps). */
const REVIEWABLE_STATUSES: OnboardingStatus[] = [
	"pending_review",
	"active",
	"rejected",
];

interface ListSellersParams {
	page?: number;
	limit?: number;
	status?: OnboardingStatus;
	search?: string;
	sortBy?: "name" | "createdAt";
	sortOrder?: "asc" | "desc";
}

export async function listSellers(params: ListSellersParams) {
	const { page, limit, offset } = parsePagination(params);

	const statusCondition = params.status
		? eq(sellerProfile.onboardingStatus, params.status)
		: inArray(sellerProfile.onboardingStatus, REVIEWABLE_STATUSES);

	const searchCondition = params.search
		? (() => {
				const term = `%${params.search}%`;
				return inArray(
					sellerProfile.id,
					db
						.selectDistinct({ id: sellerProfile.id })
						.from(sellerProfile)
						.leftJoin(user, eq(user.id, sellerProfile.userId))
						.leftJoin(
							organization,
							eq(organization.sellerProfileId, sellerProfile.id),
						)
						.where(
							or(
								ilike(sellerProfile.firstName, term),
								ilike(sellerProfile.lastName, term),
								ilike(user.name, term),
								ilike(user.email, term),
								ilike(organization.businessName, term),
								ilike(organization.vatNumber, term),
							),
						),
				);
			})()
		: undefined;

	const where = searchCondition
		? and(statusCondition, searchCondition)
		: statusCondition;

	const sortDir = params.sortOrder === "asc" ? asc : desc;
	const sortCol =
		params.sortBy === "name"
			? sellerProfile.firstName
			: sellerProfile.createdAt;

	const [data, [{ total }]] = await Promise.all([
		db.query.sellerProfile.findMany({
			where,
			with: { user: true, organization: true },
			limit,
			offset,
			orderBy: sortDir(sortCol),
		}),
		db.select({ total: count() }).from(sellerProfile).where(where),
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

interface SellerStatusCounts {
	pending_review: number;
	active: number;
	rejected: number;
}

export async function countSellersByStatus(): Promise<SellerStatusCounts> {
	const rows = await db
		.select({
			status: sellerProfile.onboardingStatus,
			count: count(),
		})
		.from(sellerProfile)
		.where(inArray(sellerProfile.onboardingStatus, REVIEWABLE_STATUSES))
		.groupBy(sellerProfile.onboardingStatus);

	const counts: SellerStatusCounts = {
		pending_review: 0,
		active: 0,
		rejected: 0,
	};

	for (const row of rows) {
		if (row.status in counts) {
			counts[row.status as keyof SellerStatusCounts] = row.count;
		}
	}

	return counts;
}

// ── Seller detail ───────────────────────────

export async function getSellerDetail(sellerId: string) {
	const data = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerId),
		with: { user: true, organization: true },
	});

	if (!data) throw new ServiceError(404, "Seller profile not found");
	return data;
}

// ── Change requests ─────────────────────────

interface ListPendingChangesParams {
	page?: number;
	limit?: number;
}

export async function listPendingChanges(params: ListPendingChangesParams) {
	const { page, limit, offset } = parsePagination(params);

	const [data, [{ total }]] = await Promise.all([
		db.query.sellerProfileChange.findMany({
			where: eq(sellerProfileChange.status, "pending"),
			with: {
				sellerProfile: {
					with: { user: true, organization: true },
				},
			},
			limit,
			offset,
			orderBy: (t, { asc }) => [asc(t.createdAt)],
		}),
		db
			.select({ total: count() })
			.from(sellerProfileChange)
			.where(eq(sellerProfileChange.status, "pending")),
	]);

	return { data, pagination: { page, limit, total } };
}

interface ApplyChangeData {
	[key: string]: unknown;
}

export async function approveChange(changeId: string, adminUserId: string) {
	const change = await db.query.sellerProfileChange.findFirst({
		where: eq(sellerProfileChange.id, changeId),
	});

	if (!change) throw new ServiceError(404, "Change request not found");
	if (change.status !== "pending") {
		throw new ServiceError(400, "Change request is not pending");
	}

	const changeData = change.changeData as ApplyChangeData;

	return db.transaction(async (tx) => {
		// Apply the change based on type
		if (change.changeType === "vat") {
			await tx
				.update(organization)
				.set({
					vatNumber: changeData.vatNumber as string,
					vatStatus: "verified",
				})
				.where(eq(organization.sellerProfileId, change.sellerProfileId));

			// Unblock new orders
			await tx
				.update(sellerProfile)
				.set({ vatChangeBlocked: false })
				.where(eq(sellerProfile.id, change.sellerProfileId));
		}

		if (change.changeType === "document") {
			await tx
				.update(sellerProfile)
				.set({
					documentNumber: changeData.documentNumber as string,
					documentExpiry: changeData.documentExpiry as string,
					documentIssuedMunicipality:
						changeData.documentIssuedMunicipality as string,
					...(changeData.documentImageKey
						? {
								documentImageKey: changeData.documentImageKey as string,
								documentImageUrl: changeData.documentImageUrl as string,
							}
						: {}),
				})
				.where(eq(sellerProfile.id, change.sellerProfileId));
		}

		if (change.changeType === "payment") {
			// Update existing default payment method or create a new one
			const existing = await tx.query.paymentMethod.findFirst({
				where: and(
					eq(paymentMethod.sellerProfileId, change.sellerProfileId),
					eq(paymentMethod.isDefault, true),
				),
			});

			if (existing) {
				await tx
					.update(paymentMethod)
					.set({ stripeAccountId: changeData.stripeAccountId as string })
					.where(eq(paymentMethod.id, existing.id));
			} else {
				await tx.insert(paymentMethod).values({
					sellerProfileId: change.sellerProfileId,
					stripeAccountId: changeData.stripeAccountId as string,
				});
			}
		}

		// Mark change as approved
		const [updated] = await tx
			.update(sellerProfileChange)
			.set({
				status: "approved",
				reviewedBy: adminUserId,
				reviewedAt: new Date(),
			})
			.where(eq(sellerProfileChange.id, changeId))
			.returning();

		return updated;
	});
}

interface RejectChangeParams {
	changeId: string;
	adminUserId: string;
	reason?: string;
}

export async function rejectChange(params: RejectChangeParams) {
	const { changeId, adminUserId, reason } = params;

	const change = await db.query.sellerProfileChange.findFirst({
		where: eq(sellerProfileChange.id, changeId),
	});

	if (!change) throw new ServiceError(404, "Change request not found");
	if (change.status !== "pending") {
		throw new ServiceError(400, "Change request is not pending");
	}

	return db.transaction(async (tx) => {
		// If it was a VAT change, unblock new orders
		if (change.changeType === "vat") {
			await tx
				.update(sellerProfile)
				.set({ vatChangeBlocked: false })
				.where(eq(sellerProfile.id, change.sellerProfileId));
		}

		const [updated] = await tx
			.update(sellerProfileChange)
			.set({
				status: "rejected",
				reviewedBy: adminUserId,
				reviewedAt: new Date(),
				rejectionReason: reason ?? null,
			})
			.where(eq(sellerProfileChange.id, changeId))
			.returning();

		return updated;
	});
}
