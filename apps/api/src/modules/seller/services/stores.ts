import type { Static } from "@sinclair/typebox";
import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
	municipality as municipalityTable,
	province as provinceTable,
} from "@/db/schemas/location";
import {
	storePhoneNumber as storePhoneNumberTable,
	store as storeTable,
} from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { ServiceError } from "@/lib/errors";
import type { CustomClosure } from "@/lib/holidays";
import {
	municipalityCompactWith,
	toMunicipalityCompact,
} from "@/lib/municipality";
import { validateOpeningHours } from "@/lib/opening-hours";
import { parsePagination } from "@/lib/pagination";
import type { OpeningHoursSchema } from "@/lib/schemas/forms/opening-hours";
import { resolveOpenStatuses } from "@/lib/store-open-status";
import { stripe } from "@/lib/stripe";

type OpeningHours = Static<typeof OpeningHoursSchema>;

interface ListStoresParams {
	sellerProfileId: string;
	/** undefined = no filter (owner sees all). Empty array = no stores. Non-empty = filter to listed IDs. */
	filterStoreIds?: string[];
	page?: number;
	limit?: number;
}

export async function listStores(params: ListStoresParams) {
	const { sellerProfileId, filterStoreIds } = params;
	const { page, limit, offset } = parsePagination(params);

	// Special case: explicit empty array means "no accessible stores" — return zero.
	if (filterStoreIds !== undefined && filterStoreIds.length === 0) {
		return { data: [], pagination: { page, limit, total: 0 } };
	}

	const where = and(
		eq(storeTable.sellerProfileId, sellerProfileId),
		isNull(storeTable.deletedAt),
		filterStoreIds !== undefined
			? inArray(storeTable.id, filterStoreIds)
			: undefined,
	);

	const [rawData, [{ total }]] = await Promise.all([
		db.query.store.findMany({
			where,
			limit,
			offset,
			with: {
				phoneNumbers: true,
				category: true,
				images: true,
				municipality: municipalityCompactWith,
			},
		}),
		db.select({ total: count() }).from(storeTable).where(where),
	]);

	const data = rawData.map(({ municipality, ...rest }) => ({
		...rest,
		municipality: toMunicipalityCompact(municipality),
	}));

	const statusMap = await resolveOpenStatuses(
		data.map((s) => ({
			id: s.id,
			openingHours: s.openingHours ?? null,
			closures: (s.closures as CustomClosure[] | null) ?? null,
		})),
		new Date(),
	);
	const dataWithStatus = data.map((s) => ({
		...s,
		openStatus: statusMap.get(s.id) ?? null,
	}));

	return { data: dataWithStatus, pagination: { page, limit, total } };
}

interface CreateStoreParams {
	sellerProfileId: string;
	name: string;
	description?: string;
	addressLine1: string;
	addressLine2?: string;
	municipalityId: string;
	zipCode: string;
	country?: string;
	location?: { x: number; y: number };
	categoryId?: string;
	openingHours?: OpeningHours | null;
	websiteUrl?: string | null;
	phoneNumbers?: Array<{ label?: string; number: string; position?: number }>;
}

export async function createStore(params: CreateStoreParams) {
	const { phoneNumbers, ...storeData } = params;

	if (Array.isArray(storeData.openingHours)) {
		const hoursError = validateOpeningHours(storeData.openingHours);
		if (hoursError) throw new ServiceError(400, hoursError);
	}

	return db.transaction(async (tx) => {
		const [created] = await tx.insert(storeTable).values(storeData).returning();

		if (phoneNumbers && phoneNumbers.length > 0) {
			const phoneValues = phoneNumbers.map((p, idx) => ({
				storeId: created.id,
				label: p.label,
				number: p.number,
				position: p.position ?? idx,
			}));

			await tx.insert(storePhoneNumberTable).values(phoneValues);
		}

		const raw = await tx.query.store.findFirst({
			where: eq(storeTable.id, created.id),
			with: {
				phoneNumbers: true,
				category: true,
				images: true,
				municipality: municipalityCompactWith,
			},
		});

		if (!raw) throw new ServiceError(500, "Failed to retrieve created store");
		const { municipality, ...rest } = raw;
		return {
			...rest,
			municipality: toMunicipalityCompact(municipality),
		};
	});
}

interface UpdateStoreParams {
	storeId: string;
	sellerProfileId: string;
	name?: string;
	description?: string;
	addressLine1?: string;
	addressLine2?: string;
	municipalityId?: string;
	zipCode?: string;
	country?: string;
	location?: { x: number; y: number };
	categoryId?: string | null;
	openingHours?: OpeningHours | null;
	websiteUrl?: string | null;
	phoneNumbers?: Array<{ label?: string; number: string; position?: number }>;
}

export async function updateStore(params: UpdateStoreParams) {
	const { storeId, sellerProfileId, phoneNumbers, ...data } = params;

	if (Array.isArray(data.openingHours)) {
		const hoursError = validateOpeningHours(data.openingHours);
		if (hoursError) throw new ServiceError(400, hoursError);
	}

	return db.transaction(async (tx) => {
		// Only issue the UPDATE if there are plain store columns to change.
		// With only phoneNumbers we'd call .set({}) and Drizzle throws
		// "No values to set" — fetch the row instead so ownership is still enforced.
		const hasStoreData = Object.keys(data).length > 0;

		const [updated] = hasStoreData
			? await tx
					.update(storeTable)
					.set(data)
					.where(
						and(
							eq(storeTable.id, storeId),
							eq(storeTable.sellerProfileId, sellerProfileId),
							isNull(storeTable.deletedAt),
						),
					)
					.returning()
			: await tx
					.select()
					.from(storeTable)
					.where(
						and(
							eq(storeTable.id, storeId),
							eq(storeTable.sellerProfileId, sellerProfileId),
							isNull(storeTable.deletedAt),
						),
					);

		if (!updated) throw new ServiceError(404, "Store not found");

		if (phoneNumbers !== undefined) {
			await tx
				.delete(storePhoneNumberTable)
				.where(eq(storePhoneNumberTable.storeId, storeId));

			if (phoneNumbers.length > 0) {
				const phoneValues = phoneNumbers.map((p, idx) => ({
					storeId,
					label: p.label,
					number: p.number,
					position: p.position ?? idx,
				}));

				await tx.insert(storePhoneNumberTable).values(phoneValues);
			}
		}

		const rawUpdated = await tx.query.store.findFirst({
			where: eq(storeTable.id, storeId),
			with: {
				phoneNumbers: true,
				category: true,
				images: true,
				municipality: municipalityCompactWith,
			},
		});

		if (!rawUpdated)
			throw new ServiceError(500, "Failed to retrieve updated store");
		const { municipality, ...updatedRest } = rawUpdated;
		return {
			...updatedRest,
			municipality: toMunicipalityCompact(municipality),
		};
	});
}

interface DeleteStoreParams {
	storeId: string;
	sellerProfileId: string;
}

export async function deleteStore(params: DeleteStoreParams) {
	const { storeId, sellerProfileId } = params;

	const [deleted] = await db
		.update(storeTable)
		.set({ deletedAt: new Date() })
		.where(
			and(
				eq(storeTable.id, storeId),
				eq(storeTable.sellerProfileId, sellerProfileId),
				isNull(storeTable.deletedAt),
			),
		)
		.returning();

	if (!deleted) throw new ServiceError(404, "Store not found");
	return deleted;
}

// ── Subscription cancel / reactivate ─────────────────────────────────────────

interface SubParams {
	sellerProfileId: string;
	storeId: string;
}

interface CancelResult {
	status: "canceling" | "canceled";
	effectiveAt: Date;
}

interface ReactivateResult {
	status: "active";
}

async function loadOwnedSubscription(params: SubParams) {
	const sub = await db.query.storeSubscription.findFirst({
		where: eq(storeSubscription.storeId, params.storeId),
		with: { store: { columns: { sellerProfileId: true } } },
	});
	if (!sub) {
		throw new ServiceError(404, "Subscription non trovata");
	}
	if (sub.store.sellerProfileId !== params.sellerProfileId) {
		throw new ServiceError(403, "Non sei owner di questo negozio");
	}
	return sub;
}

export async function cancelStoreSubscription(
	params: SubParams,
): Promise<CancelResult> {
	const sub = await loadOwnedSubscription(params);

	switch (sub.status) {
		case "active":
		case "past_due": {
			// Stripe first: persist cancelReason only after Stripe confirms the
			// mutation. If Stripe throws, the DB write below never runs, so the
			// row never ends up flagged 'seller_canceled' while the subscription
			// is still live in Stripe (mirrors reactivateStoreSubscription).
			await stripe.subscriptions.update(sub.stripeSubscriptionId, {
				cancel_at_period_end: true,
			});
			await db
				.update(storeSubscription)
				.set({ cancelReason: "seller_canceled" })
				.where(eq(storeSubscription.id, sub.id));
			return { status: "canceling", effectiveAt: sub.currentPeriodEnd };
		}
		case "suspended": {
			// Immediate cancel — DB-first here (unlike the branch above): write the
			// reason BEFORE the Stripe call so the resulting subscription.deleted
			// webhook, which defaults a missing reason to 'payment_failed_auto'
			// (see subscription-deleted.ts), preserves the 'seller_canceled'
			// attribution. To still satisfy 918 (no stale reason on a live sub) we
			// revert the reason if the Stripe cancel fails.
			await db
				.update(storeSubscription)
				.set({ cancelReason: "seller_canceled" })
				.where(eq(storeSubscription.id, sub.id));
			try {
				await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
			} catch (err) {
				await db
					.update(storeSubscription)
					.set({ cancelReason: sub.cancelReason })
					.where(eq(storeSubscription.id, sub.id));
				throw err;
			}
			return { status: "canceled", effectiveAt: new Date() };
		}
		case "canceling": {
			return { status: "canceling", effectiveAt: sub.currentPeriodEnd };
		}
		case "canceled": {
			throw new ServiceError(404, "Negozio già cancellato");
		}
		default: {
			const _exhaust: never = sub.status;
			throw new ServiceError(500, `Unhandled subscription status: ${_exhaust}`);
		}
	}
}

export async function reactivateStoreSubscription(
	params: SubParams,
): Promise<ReactivateResult> {
	const sub = await loadOwnedSubscription(params);
	if (sub.status !== "canceling") {
		throw new ServiceError(409, "Negozio non in cancellazione");
	}
	await stripe.subscriptions.update(sub.stripeSubscriptionId, {
		cancel_at_period_end: false,
	});
	return { status: "active" };
}

interface ListArchivedParams {
	sellerProfileId: string;
	page: number;
	limit: number;
}

export async function listArchivedStores(params: ListArchivedParams) {
	const limit = Math.min(params.limit, 100);
	const offset = (params.page - 1) * limit;

	const baseWhere = and(
		eq(storeTable.sellerProfileId, params.sellerProfileId),
		isNotNull(storeTable.deletedAt),
	);

	const data = await db
		.select({
			id: storeTable.id,
			name: storeTable.name,
			addressLine1: storeTable.addressLine1,
			municipalityId: storeTable.municipalityId,
			municipalityName: municipalityTable.name,
			provinceAcronym: provinceTable.acronym,
			createdAt: storeTable.createdAt,
			deletedAt: storeTable.deletedAt,
			canceledAt: storeSubscription.canceledAt,
			cancelReason: storeSubscription.cancelReason,
		})
		.from(storeTable)
		.innerJoin(
			municipalityTable,
			eq(municipalityTable.id, storeTable.municipalityId),
		)
		.innerJoin(
			provinceTable,
			eq(provinceTable.id, municipalityTable.provinceId),
		)
		.leftJoin(storeSubscription, eq(storeSubscription.storeId, storeTable.id))
		.where(baseWhere)
		.orderBy(desc(storeTable.deletedAt))
		.limit(limit)
		.offset(offset);

	const mappedData = data.map(
		({ municipalityName, provinceAcronym, ...row }) => ({
			...row,
			municipality: {
				id: row.municipalityId,
				name: municipalityName,
				provinceAcronym,
			},
		}),
	);

	const [{ value: total } = { value: 0 }] = await db
		.select({ value: count() })
		.from(storeTable)
		.where(baseWhere);

	return {
		data: mappedData,
		pagination: { page: params.page, limit, total },
	};
}
