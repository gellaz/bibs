import { renderEmployeeInviteEmail } from "@bibs/emails";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import {
	employeeInvitation,
	employeeInvitationStores,
} from "@/db/schemas/employee-invitation";
import {
	municipality as municipalityTable,
	province as provinceTable,
} from "@/db/schemas/location";
import { sellerProfile } from "@/db/schemas/seller";
import { store as storeTable } from "@/db/schemas/store";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parsePagination } from "@/lib/pagination";
import { getSellerStoreIds } from "../context";

/** Invitation token validity: 7 days */
const INVITATION_EXPIRY_DAYS = 7;

interface ListEmployeesParams {
	sellerProfileId: string;
	page?: number;
	limit?: number;
}

export async function listEmployees(params: ListEmployeesParams) {
	const { sellerProfileId } = params;
	const { page, limit, offset } = parsePagination(params);

	const [employees, [{ total }], profile, liveStoreIds] = await Promise.all([
		db.query.storeEmployee.findMany({
			where: eq(storeEmployee.sellerProfileId, sellerProfileId),
			with: {
				user: true,
				storeAssignments: { columns: { storeId: true } },
			},
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(storeEmployee)
			.where(eq(storeEmployee.sellerProfileId, sellerProfileId)),
		db.query.sellerProfile.findFirst({
			where: eq(sellerProfile.id, sellerProfileId),
			with: { user: { columns: { id: true, name: true, email: true } } },
		}),
		getSellerStoreIds(sellerProfileId),
	]);

	// An assignment can only point at a store of this same seller (enforced on
	// write), so filtering against the seller's live store ids is equivalent to
	// `deleted_at IS NULL` — and the relational query above cannot reach `store`.
	const liveStores = new Set(liveStoreIds);

	const data = employees.map((e) => ({
		...e,
		storeIds: e.storeAssignments
			.map((a) => a.storeId)
			.filter((id) => liveStores.has(id)),
	}));

	const owner = profile?.user
		? {
				id: profile.user.id,
				name: profile.user.name,
				email: profile.user.email,
			}
		: null;

	return { data, pagination: { page, limit, total }, owner };
}

export async function inviteEmployee(
	sellerProfileId: string,
	email: string,
	storeIds: string[],
) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
		with: { organization: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");

	// Validate storeIds belong to seller AND non-empty
	if (storeIds.length === 0) {
		throw new ServiceError(400, "Almeno un negozio deve essere selezionato");
	}
	const valid = await db
		.select({ id: storeTable.id })
		.from(storeTable)
		.where(
			and(
				inArray(storeTable.id, storeIds),
				eq(storeTable.sellerProfileId, sellerProfileId),
				isNull(storeTable.deletedAt),
			),
		);
	if (valid.length !== storeIds.length) {
		throw new ServiceError(
			404,
			"Uno o più negozi non appartengono al tuo profilo",
		);
	}

	// Check if this email was already invited for this seller
	const existing = await db.query.employeeInvitation.findFirst({
		where: and(
			eq(employeeInvitation.sellerProfileId, sellerProfileId),
			eq(employeeInvitation.email, email),
			eq(employeeInvitation.status, "pending"),
		),
	});
	if (existing) {
		throw new ServiceError(409, "Questo indirizzo email è già stato invitato");
	}

	// Check if email is already registered as a user
	const existingUser = await db.query.user.findFirst({
		where: eq(user.email, email),
	});
	if (existingUser) {
		throw new ServiceError(
			409,
			"Questo indirizzo email è già registrato nella piattaforma",
		);
	}

	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

	const invitation = await db.transaction(async (tx) => {
		const [inv] = await tx
			.insert(employeeInvitation)
			.values({ sellerProfileId, email, expiresAt })
			.returning();
		await tx
			.insert(employeeInvitationStores)
			.values(storeIds.map((storeId) => ({ invitationId: inv.id, storeId })));
		return inv;
	});

	// Best-effort: a failed invite email (render or send) must not turn a
	// committed invitation into a 500 — the seller can resend from the UI.
	try {
		const businessName = profile.organization?.businessName ?? "bibs";
		const inviteUrl = `${env.SELLER_APP_URL}/invite/${invitation.invitationToken}`;

		const { subject, html } = await renderEmployeeInviteEmail({
			businessName,
			inviteUrl,
			expiryDays: INVITATION_EXPIRY_DAYS,
		});
		await sendEmail({ to: email, subject, html });
	} catch (err) {
		logger.warn({ err, email }, "invite email failed after invitation commit");
	}

	return { ...invitation, storeIds };
}

export async function listEmployeeInvitations(sellerProfileId: string) {
	// Only pending invitations are actionable; accepted/expired rows are append-only
	// history the client discards anyway. Filtering server-side keeps the result
	// bounded (uses the partial pending-unique index) instead of returning the full
	// invitation log.
	const [invitations, liveStoreIds] = await Promise.all([
		db.query.employeeInvitation.findMany({
			where: and(
				eq(employeeInvitation.sellerProfileId, sellerProfileId),
				eq(employeeInvitation.status, "pending"),
			),
			with: { storeAssignments: { columns: { storeId: true } } },
			orderBy: (inv, { desc }) => [desc(inv.createdAt)],
		}),
		getSellerStoreIds(sellerProfileId),
	]);
	const liveStores = new Set(liveStoreIds);
	return invitations.map((i) => ({
		...i,
		storeIds: i.storeAssignments
			.map((a) => a.storeId)
			.filter((id) => liveStores.has(id)),
	}));
}

export async function cancelInvitation(
	sellerProfileId: string,
	invitationId: string,
) {
	const invitation = await db.query.employeeInvitation.findFirst({
		where: and(
			eq(employeeInvitation.id, invitationId),
			eq(employeeInvitation.sellerProfileId, sellerProfileId),
			eq(employeeInvitation.status, "pending"),
		),
		with: { storeAssignments: { columns: { storeId: true } } },
	});

	if (!invitation) throw new ServiceError(404, "Invito non trovato");

	const [updated] = await db
		.update(employeeInvitation)
		.set({ status: "expired" })
		.where(eq(employeeInvitation.id, invitationId))
		.returning();

	return {
		...updated,
		storeIds: invitation.storeAssignments.map((a) => a.storeId),
	};
}

interface EmployeeActionParams {
	employeeId: string;
	sellerProfileId: string;
}

export async function banEmployee(params: EmployeeActionParams) {
	const { employeeId, sellerProfileId } = params;

	const [updated] = await db
		.update(storeEmployee)
		.set({ status: "banned" })
		.where(
			and(
				eq(storeEmployee.id, employeeId),
				eq(storeEmployee.sellerProfileId, sellerProfileId),
			),
		)
		.returning();

	if (!updated) throw new ServiceError(404, "Employee not found");
	return updated;
}

export async function unbanEmployee(params: EmployeeActionParams) {
	const { employeeId, sellerProfileId } = params;

	const [updated] = await db
		.update(storeEmployee)
		.set({ status: "active" })
		.where(
			and(
				eq(storeEmployee.id, employeeId),
				eq(storeEmployee.sellerProfileId, sellerProfileId),
			),
		)
		.returning();

	if (!updated) throw new ServiceError(404, "Employee not found");
	return updated;
}

export async function removeEmployee(params: EmployeeActionParams) {
	const { employeeId, sellerProfileId } = params;

	const [updated] = await db
		.update(storeEmployee)
		.set({ status: "removed" })
		.where(
			and(
				eq(storeEmployee.id, employeeId),
				eq(storeEmployee.sellerProfileId, sellerProfileId),
			),
		)
		.returning();

	if (!updated) throw new ServiceError(404, "Employee not found");
	return updated;
}

interface EmployeeStoresParams {
	sellerProfileId: string;
	employeeId: string;
}

export async function getEmployeeStores(params: EmployeeStoresParams) {
	// Verify employee belongs to this seller (404 otherwise)
	const emp = await db.query.storeEmployee.findFirst({
		where: and(
			eq(storeEmployee.id, params.employeeId),
			eq(storeEmployee.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!emp) throw new ServiceError(404, "Employee not found");

	const rows = await db
		.select({
			id: storeTable.id,
			name: storeTable.name,
			municipalityId: storeTable.municipalityId,
			municipalityName: municipalityTable.name,
			provinceAcronym: provinceTable.acronym,
		})
		.from(storeEmployeeStores)
		.innerJoin(storeTable, eq(storeEmployeeStores.storeId, storeTable.id))
		.innerJoin(
			municipalityTable,
			eq(municipalityTable.id, storeTable.municipalityId),
		)
		.innerJoin(
			provinceTable,
			eq(provinceTable.id, municipalityTable.provinceId),
		)
		.where(
			and(
				eq(storeEmployeeStores.storeEmployeeId, params.employeeId),
				isNull(storeTable.deletedAt),
			),
		);

	return rows.map(({ municipalityName, provinceAcronym, ...row }) => ({
		...row,
		municipality: {
			id: row.municipalityId,
			name: municipalityName,
			provinceAcronym,
		},
	}));
}

interface SetEmployeeStoresParams extends EmployeeStoresParams {
	storeIds: string[];
}

export async function setEmployeeStores(params: SetEmployeeStoresParams) {
	// Verify employee belongs to seller (404)
	const emp = await db.query.storeEmployee.findFirst({
		where: and(
			eq(storeEmployee.id, params.employeeId),
			eq(storeEmployee.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!emp) throw new ServiceError(404, "Employee not found");

	// Validate every storeId belongs to this seller (use Set to dedupe defensively)
	const uniqueStoreIds = Array.from(new Set(params.storeIds));
	if (uniqueStoreIds.length > 0) {
		const valid = await db
			.select({ id: storeTable.id })
			.from(storeTable)
			.where(
				and(
					inArray(storeTable.id, uniqueStoreIds),
					eq(storeTable.sellerProfileId, params.sellerProfileId),
					isNull(storeTable.deletedAt),
				),
			);
		if (valid.length !== uniqueStoreIds.length) {
			throw new ServiceError(
				404,
				"Uno o più negozi non appartengono al tuo profilo",
			);
		}
	}

	await db.transaction(async (tx) => {
		// Replace only the assignments the owner can actually see and manage:
		// the live ones. Rows pointing at soft-deleted stores are dormant intent
		// (and cannot be re-inserted, the validation above rejects them), so a
		// save must not destroy them.
		await tx.delete(storeEmployeeStores).where(
			and(
				eq(storeEmployeeStores.storeEmployeeId, params.employeeId),
				inArray(
					storeEmployeeStores.storeId,
					tx
						.select({ id: storeTable.id })
						.from(storeTable)
						.where(
							and(
								eq(storeTable.sellerProfileId, params.sellerProfileId),
								isNull(storeTable.deletedAt),
							),
						),
				),
			),
		);
		if (uniqueStoreIds.length > 0) {
			// The liveness validation above runs outside this transaction, so a
			// store can be soft-deleted in the window between that check and here
			// (another tab, the subscription.deleted webhook, the
			// auto-cancel-suspended-stores job). When that happens the delete above
			// no longer matches the pre-existing row for that store (it only
			// targets live stores), but we're still about to insert it — a PK
			// conflict on (storeEmployeeId, storeId). onConflictDoNothing() leaves
			// the surviving dormant row untouched, which is exactly the invariant's
			// desired end state.
			await tx
				.insert(storeEmployeeStores)
				.values(
					uniqueStoreIds.map((storeId) => ({
						storeEmployeeId: params.employeeId,
						storeId,
					})),
				)
				.onConflictDoNothing();
		}
	});

	return getEmployeeStores(params);
}
