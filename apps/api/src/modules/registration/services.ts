import { and, eq } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { storeEmployee } from "@/db/schemas/employee";
import { employeeInvitation } from "@/db/schemas/employee-invitation";
import { organization } from "@/db/schemas/organization";
import { sellerProfile } from "@/db/schemas/seller";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";

// ── Shared registration helper ──────────────

interface RegisterUserParams<T> {
	email: string;
	password: string;
	role: string;
	callbackURL: string;
	createProfile: (
		tx: PgTransaction<any, any, any>,
		userId: string,
	) => Promise<T>;
}

async function registerUser<T>(params: RegisterUserParams<T>) {
	const { email, password, role, callbackURL, createProfile } = params;
	const name = email.split("@")[0];

	const existing = await db.query.user.findFirst({
		where: eq(user.email, email),
	});
	if (existing) {
		throw new ServiceError(409, "Email already registered");
	}

	const { user: newUser, token } = await auth.api.signUpEmail({
		body: { name, email, password },
	});

	const profile = await db.transaction(async (tx) => {
		await tx.update(user).set({ role }).where(eq(user.id, newUser.id));

		return createProfile(tx, newUser.id);
	});

	await auth.api.sendVerificationEmail({
		body: { email, callbackURL },
	});

	return {
		user: { ...newUser, role },
		profile,
		token,
	};
}

// ── Public registration functions ───────────

interface RegisterParams {
	email: string;
	password: string;
}

export async function registerCustomer(params: RegisterParams) {
	return registerUser({
		...params,
		role: "customer",
		callbackURL: `${env.CUSTOMER_APP_URL}/login`,
		async createProfile(tx, userId) {
			const [profile] = await tx
				.insert(customerProfile)
				.values({ userId })
				.returning();
			return profile;
		},
	});
}

export async function registerSeller(params: RegisterParams) {
	return registerUser({
		...params,
		role: "seller",
		callbackURL: `${env.SELLER_APP_URL}/login`,
		async createProfile(tx, userId) {
			const [profile] = await tx
				.insert(sellerProfile)
				.values({ userId })
				.returning();
			return profile;
		},
	});
}

// ── Accept employee invitation ──────────────

interface AcceptInviteParams {
	token: string;
	password: string;
}

export async function acceptInvite(params: AcceptInviteParams) {
	const { token, password } = params;

	// Find the invitation by token
	const invitation = await db.query.employeeInvitation.findFirst({
		where: and(
			eq(employeeInvitation.invitationToken, token),
			eq(employeeInvitation.status, "pending"),
		),
	});

	if (!invitation) {
		throw new ServiceError(404, "Invito non trovato o già utilizzato");
	}

	if (new Date() > invitation.expiresAt) {
		// Mark as expired
		await db
			.update(employeeInvitation)
			.set({ status: "expired" })
			.where(eq(employeeInvitation.id, invitation.id));
		throw new ServiceError(400, "L'invito è scaduto");
	}

	// Check if email is already registered
	const existingUser = await db.query.user.findFirst({
		where: eq(user.email, invitation.email),
	});
	if (existingUser) {
		throw new ServiceError(409, "Questo indirizzo email è già registrato");
	}

	// Create the user account via better-auth
	const name = invitation.email.split("@")[0];
	const { user: newUser } = await auth.api.signUpEmail({
		body: { name, email: invitation.email, password },
	});

	// Set role, verify email, create employee record, mark invitation
	await db.transaction(async (tx) => {
		await tx
			.update(user)
			.set({ role: "employee", emailVerified: true })
			.where(eq(user.id, newUser.id));

		await tx.insert(storeEmployee).values({
			sellerProfileId: invitation.sellerProfileId,
			userId: newUser.id,
		});

		await tx
			.update(employeeInvitation)
			.set({ status: "accepted" })
			.where(eq(employeeInvitation.id, invitation.id));
	});

	return { message: "Account creato con successo. Ora puoi accedere." };
}

interface SignInParams {
	email: string;
	password: string;
}

export async function signIn(params: SignInParams) {
	const { email, password } = params;

	const result = await auth.api.signInEmail({
		body: { email, password },
	});

	if (!result.user) {
		throw new ServiceError(401, "Invalid credentials");
	}

	const userRecord = await db.query.user.findFirst({
		where: eq(user.id, result.user.id),
	});

	if (!userRecord) {
		throw new ServiceError(404, "User not found");
	}

	const [customerProf, sellerProf] = await Promise.all([
		db.query.customerProfile.findFirst({
			where: eq(customerProfile.userId, userRecord.id),
		}),
		db.query.sellerProfile.findFirst({
			where: eq(sellerProfile.userId, userRecord.id),
		}),
	]);

	// If seller, also fetch organization
	let org = null;
	if (sellerProf) {
		org =
			(await db.query.organization.findFirst({
				where: eq(organization.sellerProfileId, sellerProf.id),
			})) ?? null;
	}

	return {
		user: userRecord,
		profiles: {
			customer: customerProf || null,
			seller: sellerProf || null,
		},
		organization: org,
		token: result.token,
	};
}
