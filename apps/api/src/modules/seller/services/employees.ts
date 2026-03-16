import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { storeEmployee } from "@/db/schemas/employee";
import { employeeInvitation } from "@/db/schemas/employee-invitation";
import { sellerProfile } from "@/db/schemas/seller";
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

	const [data, [{ total }], profile] = await Promise.all([
		db.query.storeEmployee.findMany({
			where: eq(storeEmployee.sellerProfileId, sellerProfileId),
			with: { user: true },
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

	const owner = profile?.user
		? {
				id: profile.user.id,
				name: profile.user.name,
				email: profile.user.email,
			}
		: null;

	return { data, pagination: { page, limit, total }, owner };
}

export async function inviteEmployee(sellerProfileId: string, email: string) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
		with: { organization: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");

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

	const [invitation] = await db
		.insert(employeeInvitation)
		.values({
			sellerProfileId,
			email,
			expiresAt,
		})
		.returning();

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

	return invitation;
}

export async function listEmployeeInvitations(sellerProfileId: string) {
	return db.query.employeeInvitation.findMany({
		where: eq(employeeInvitation.sellerProfileId, sellerProfileId),
		orderBy: (inv, { desc }) => [desc(inv.createdAt)],
	});
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
	});

	if (!invitation) throw new ServiceError(404, "Invito non trovato");

	const [updated] = await db
		.update(employeeInvitation)
		.set({ status: "expired" })
		.where(eq(employeeInvitation.id, invitationId))
		.returning();

	return updated;
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
