import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { employeeInvitation } from "@/db/schemas/employee-invitation";
import { organization } from "@/db/schemas/organization";
import { paymentMethod } from "@/db/schemas/payment-method";
import type { OnboardingStatus } from "@/db/schemas/seller";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { storeImage } from "@/db/schemas/store-image";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
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
	pending_store: "pending_company",
	pending_team: "pending_store",
	pending_payment: "pending_team",
};

/** Invitation token validity: 7 days */
const INVITATION_EXPIRY_DAYS = 7;

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
	images?: File[];
}

export async function createOnboardingStore(params: StoreParams) {
	const { userId, useCompanyAddress, images, ...data } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
		with: { organization: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertStatus(profile.onboardingStatus, "pending_store");

	// Validate image count
	if (images && images.length > config.maxImagesPerStore) {
		throw new ServiceError(
			400,
			`Maximum ${config.maxImagesPerStore} images per store (uploading: ${images.length})`,
		);
	}

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

	// Upload images to S3 (before the transaction, so we can clean up on failure)
	const uploaded: { key: string; url: string; position: number }[] = [];
	if (images && images.length > 0) {
		try {
			await Promise.all(
				images.map(async (file, i) => {
					const ext = file.name?.split(".").pop() ?? "jpg";
					// Use a temporary prefix; we don't have storeId yet
					const tempKey = `stores/pending-${profile.id}/${crypto.randomUUID()}.${ext}`;
					await s3.write(tempKey, file);
					uploaded.push({ key: tempKey, url: publicUrl(tempKey), position: i });
				}),
			);
		} catch (err) {
			await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
			throw err;
		}
	}

	try {
		return await db.transaction(async (tx) => {
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

			// Insert image records if any were uploaded
			if (uploaded.length > 0) {
				await tx.insert(storeImage).values(
					uploaded.map((u) => ({
						storeId: newStore.id,
						...u,
					})),
				);
			}

			const [updated] = await tx
				.update(sellerProfile)
				.set({ onboardingStatus: "pending_team" })
				.where(eq(sellerProfile.userId, userId))
				.returning();

			// Re-fetch store with images for response
			const storeWithImages = await tx.query.store.findFirst({
				where: eq(store.id, newStore.id),
				with: { images: true },
			});

			return { profile: updated, store: storeWithImages ?? newStore };
		});
	} catch (err) {
		// Transaction failed — cleanup S3 files (best-effort)
		if (uploaded.length > 0) {
			await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		}
		throw err;
	}
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
		.set({ onboardingStatus: "pending_team" })
		.where(eq(sellerProfile.userId, userId))
		.returning();

	return updated;
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
		if (profile.onboardingStatus === "pending_store") {
			await tx
				.delete(organization)
				.where(eq(organization.sellerProfileId, profile.id));
		}
		if (profile.onboardingStatus === "pending_team") {
			await tx.delete(store).where(eq(store.sellerProfileId, profile.id));
		}
		if (profile.onboardingStatus === "pending_payment") {
			await tx
				.delete(paymentMethod)
				.where(eq(paymentMethod.sellerProfileId, profile.id));
		}

		const [updated] = await tx
			.update(sellerProfile)
			.set({ onboardingStatus: previousStatus })
			.where(eq(sellerProfile.userId, userId))
			.returning();

		return updated;
	});
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

// ── Step 5: Team

export async function inviteTeamMember(userId: string, email: string) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
		with: { organization: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertStatus(profile.onboardingStatus, "pending_team");

	// Check if this email was already invited for this seller
	const existing = await db.query.employeeInvitation.findFirst({
		where: and(
			eq(employeeInvitation.sellerProfileId, profile.id),
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
			sellerProfileId: profile.id,
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

export async function listOnboardingInvitations(userId: string) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");

	return db.query.employeeInvitation.findMany({
		where: eq(employeeInvitation.sellerProfileId, profile.id),
		orderBy: (inv, { desc }) => [desc(inv.createdAt)],
	});
}

export async function completeTeam(userId: string) {
	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.userId, userId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertStatus(profile.onboardingStatus, "pending_team");

	const [updated] = await db
		.update(sellerProfile)
		.set({ onboardingStatus: "pending_payment" })
		.where(eq(sellerProfile.userId, userId))
		.returning();

	return updated;
}
