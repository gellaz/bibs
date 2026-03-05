import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { organization } from "@/db/schemas/organization";
import { paymentMethod } from "@/db/schemas/payment-method";
import type { OnboardingStatus } from "@/db/schemas/seller";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { publicUrl, s3 } from "@/lib/s3";

// ── Helpers ─────────────────────────────────

function assertStatus(current: OnboardingStatus, expected: OnboardingStatus) {
	if (current !== expected) {
		throw new ServiceError(
			400,
			`Cannot perform this step: onboarding is at '${current}', expected '${expected}'`,
		);
	}
}

// ── GET status ──────────────────────────────

export async function getOnboardingStatus(userId: string) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
		with: { organization: true },
	});

	if (!profile) {
		throw new ServiceError(404, "Seller profile not found");
	}

	return profile;
}

// ── Step 1: Personal info ───────────────────

interface PersonalInfoParams {
	userId: string;
	firstName: string;
	lastName: string;
	citizenship: string;
	birthCountry: string;
	birthDate: string;
	residenceCountry: string;
	residenceCity: string;
	residenceAddress: string;
	residenceZipCode: string;
}

export async function updatePersonalInfo(params: PersonalInfoParams) {
	const { userId, ...data } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertStatus(profile.onboardingStatus, "pending_personal");

	return db.transaction(async (tx) => {
		// Save firstName/lastName/birthDate on the user table (shared across all roles)
		await tx
			.update(user)
			.set({
				firstName: data.firstName,
				lastName: data.lastName,
				birthDate: data.birthDate,
				name: `${data.firstName} ${data.lastName}`,
			})
			.where(eq(user.id, userId));

		// Save all fields (including seller-specific ones) on seller_profiles
		const [updated] = await tx
			.update(sellerProfile)
			.set({ ...data, onboardingStatus: "pending_document" })
			.where(eq(sellerProfile.userId, userId))
			.returning();

		return updated;
	});
}

// ── Step 2: Document ────────────────────────

interface DocumentParams {
	userId: string;
	documentNumber: string;
	documentExpiry: string;
	documentIssuedMunicipality: string;
	documentImage: File;
}

export async function updateDocument(params: DocumentParams) {
	const { userId, documentImage, ...data } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertStatus(profile.onboardingStatus, "pending_document");

	// Upload document image to S3
	const key = `documents/${profile.id}/${crypto.randomUUID()}`;
	await s3.write(key, documentImage);
	const url = publicUrl(key);

	const [updated] = await db
		.update(sellerProfile)
		.set({
			...data,
			documentImageKey: key,
			documentImageUrl: url,
			onboardingStatus: "pending_company",
		})
		.where(eq(sellerProfile.userId, userId))
		.returning();

	return updated;
}

// ── Step 3: Company ─────────────────────────

interface CompanyParams {
	userId: string;
	businessName: string;
	vatNumber: string;
	legalForm: string;
	addressLine1: string;
	country?: string;
	province?: string;
	city: string;
	zipCode: string;
}

export async function updateCompany(params: CompanyParams) {
	const { userId, ...data } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertStatus(profile.onboardingStatus, "pending_company");

	return db.transaction(async (tx) => {
		await tx.insert(organization).values({
			sellerProfileId: profile.id,
			businessName: data.businessName,
			vatNumber: data.vatNumber,
			legalForm: data.legalForm,
			addressLine1: data.addressLine1,
			country: data.country ?? "IT",
			province: data.province,
			city: data.city,
			zipCode: data.zipCode,
		});

		const [updated] = await tx
			.update(sellerProfile)
			.set({ onboardingStatus: "pending_store" })
			.where(eq(sellerProfile.userId, userId))
			.returning();

		return updated;
	});
}

// ── Step 4: Store ───────────────────────────

interface StoreParams {
	userId: string;
	name: string;
	description?: string;
	addressLine1: string;
	province?: string;
	city: string;
	zipCode: string;
	categoryId?: string;
	openingHours?: unknown;
	useCompanyAddress?: boolean;
}

export async function createOnboardingStore(params: StoreParams) {
	const { userId, useCompanyAddress, ...data } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
		with: { organization: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertStatus(profile.onboardingStatus, "pending_store");

	let storeAddress = {
		addressLine1: data.addressLine1,
		city: data.city,
		zipCode: data.zipCode,
		province: data.province,
	};

	// Copy address from organization if flag is set
	if (useCompanyAddress && profile.organization) {
		storeAddress = {
			addressLine1: profile.organization.addressLine1,
			city: profile.organization.city,
			zipCode: profile.organization.zipCode,
			province: profile.organization.province ?? undefined,
		};
	}

	return db.transaction(async (tx) => {
		const [newStore] = await tx
			.insert(store)
			.values({
				sellerProfileId: profile.id,
				name: data.name,
				description: data.description,
				...storeAddress,
				categoryId: data.categoryId,
				openingHours: data.openingHours,
			})
			.returning();

		const [updated] = await tx
			.update(sellerProfile)
			.set({ onboardingStatus: "pending_payment" })
			.where(eq(sellerProfile.userId, userId))
			.returning();

		return { profile: updated, store: newStore };
	});
}

// ── Step 4b: Skip store ─────────────────────

export async function skipOnboardingStore(userId: string) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertStatus(profile.onboardingStatus, "pending_store");

	const [updated] = await db
		.update(sellerProfile)
		.set({ onboardingStatus: "pending_payment" })
		.where(eq(sellerProfile.userId, userId))
		.returning();

	return updated;
}

// ── Step 5: Payment ─────────────────────────

interface PaymentParams {
	userId: string;
	stripeAccountId?: string;
}

export async function updatePayment(params: PaymentParams) {
	const { userId, stripeAccountId } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertStatus(profile.onboardingStatus, "pending_payment");

	return db.transaction(async (tx) => {
		await tx.insert(paymentMethod).values({
			sellerProfileId: profile.id,
			stripeAccountId: stripeAccountId ?? null,
		});

		const [updated] = await tx
			.update(sellerProfile)
			.set({ onboardingStatus: "pending_review" })
			.where(eq(sellerProfile.userId, userId))
			.returning();

		return updated;
	});
}
