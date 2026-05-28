import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { organization } from "@/db/schemas/organization";
import type { OnboardingStatus } from "@/db/schemas/seller";
import { sellerProfile } from "@/db/schemas/seller";
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

const PREVIOUS_STATUS: Partial<Record<OnboardingStatus, OnboardingStatus>> = {
	pending_document: "pending_personal",
	pending_company: "pending_document",
	pending_review: "pending_company",
};

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
	municipalityId: string;
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
			municipalityId: data.municipalityId,
			zipCode: data.zipCode,
		});

		const [updated] = await tx
			.update(sellerProfile)
			.set({ onboardingStatus: "pending_review" })
			.where(eq(sellerProfile.userId, userId))
			.returning();

		return updated;
	});
}

// ── Go back ─────────────────────────────────

export async function goBack(userId: string) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");

	const previousStatus = PREVIOUS_STATUS[profile.onboardingStatus];
	if (!previousStatus) {
		throw new ServiceError(
			400,
			`Cannot go back from '${profile.onboardingStatus}'`,
		);
	}

	return db.transaction(async (tx) => {
		// Clean up rows inserted by the step we're reverting from
		if (profile.onboardingStatus === "pending_review") {
			await tx
				.delete(organization)
				.where(eq(organization.sellerProfileId, profile.id));
		}

		const [updated] = await tx
			.update(sellerProfile)
			.set({ onboardingStatus: previousStatus })
			.where(eq(sellerProfile.userId, userId))
			.returning();

		return updated;
	});
}
