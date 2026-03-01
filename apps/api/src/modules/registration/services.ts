import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { sellerProfile } from "@/db/schemas/seller";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";

interface RegisterCustomerParams {
	name: string;
	email: string;
	password: string;
}

export async function registerCustomer(params: RegisterCustomerParams) {
	const { name, email, password } = params;

	const { user: newUser, token } = await auth.api.signUpEmail({
		body: { name, email, password },
	});

	const [profile] = await db.transaction(async (tx) => {
		await tx
			.update(user)
			.set({ role: "customer" })
			.where(eq(user.id, newUser.id));

		return tx
			.insert(customerProfile)
			.values({ userId: newUser.id })
			.returning();
	});

	return {
		user: { ...newUser, role: "customer" },
		profile,
		token,
	};
}

interface RegisterSellerParams {
	name: string;
	email: string;
	password: string;
	vatNumber: string;
}

export async function registerSeller(params: RegisterSellerParams) {
	const { name, email, password, vatNumber } = params;

	const { user: newUser, token } = await auth.api.signUpEmail({
		body: { name, email, password },
	});

	const [profile] = await db.transaction(async (tx) => {
		await tx
			.update(user)
			.set({ role: "seller" })
			.where(eq(user.id, newUser.id));

		return tx
			.insert(sellerProfile)
			.values({ userId: newUser.id, vatNumber })
			.returning();
	});

	return {
		user: { ...newUser, role: "seller" },
		profile,
		token,
	};
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

	return {
		user: userRecord,
		profiles: {
			customer: customerProf || null,
			seller: sellerProf || null,
		},
		token: result.token,
	};
}
