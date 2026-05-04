import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import {
	employeeInvitation,
	employeeInvitationStores,
} from "@/db/schemas/employee-invitation";
import { sellerProfile } from "@/db/schemas/seller";
import { store as storeTable } from "@/db/schemas/store";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

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

	const [employees, [{ total }], profile] = await Promise.all([
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
	]);

	const data = employees.map((e) => ({
		...e,
		storeIds: e.storeAssignments.map((a) => a.storeId),
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

	// Send invitation email
	const businessName = profile.organization?.businessName ?? "Bibs";
	const inviteUrl = `${env.SELLER_APP_URL}/invite/${invitation.invitationToken}`;

	await sendEmail({
		to: email,
		subject: `Sei stato invitato a collaborare con ${businessName} — Bibs`,
		html: [
			`<p>Ciao,</p>`,
			`<p><strong>${businessName}</strong> ti ha invitato a collaborare come membro del team su Bibs.</p>`,
			`<p>Clicca sul link seguente per creare la tua password e accedere:</p>`,
			`<p><a href="${inviteUrl}">${inviteUrl}</a></p>`,
			`<p>Il link scade tra ${INVITATION_EXPIRY_DAYS} giorni.</p>`,
			`<p>Se non conosci ${businessName} o non ti aspettavi questo invito, puoi ignorare questa email.</p>`,
		].join(""),
	});

	return { ...invitation, storeIds };
}

export async function listEmployeeInvitations(sellerProfileId: string) {
	const invitations = await db.query.employeeInvitation.findMany({
		where: eq(employeeInvitation.sellerProfileId, sellerProfileId),
		with: { storeAssignments: { columns: { storeId: true } } },
		orderBy: (inv, { desc }) => [desc(inv.createdAt)],
	});
	return invitations.map((i) => ({
		...i,
		storeIds: i.storeAssignments.map((a) => a.storeId),
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

	return db
		.select({
			id: storeTable.id,
			name: storeTable.name,
			city: storeTable.city,
			province: storeTable.province,
		})
		.from(storeEmployeeStores)
		.innerJoin(storeTable, eq(storeEmployeeStores.storeId, storeTable.id))
		.where(eq(storeEmployeeStores.storeEmployeeId, params.employeeId));
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
		await tx
			.delete(storeEmployeeStores)
			.where(eq(storeEmployeeStores.storeEmployeeId, params.employeeId));
		if (uniqueStoreIds.length > 0) {
			await tx.insert(storeEmployeeStores).values(
				uniqueStoreIds.map((storeId) => ({
					storeEmployeeId: params.employeeId,
					storeId,
				})),
			);
		}
	});

	return getEmployeeStores(params);
}
