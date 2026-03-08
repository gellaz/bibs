import { eq } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
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
