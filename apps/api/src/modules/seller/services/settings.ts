import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { organization } from "@/db/schemas/organization";
import { paymentMethod } from "@/db/schemas/payment-method";
import { sellerProfile } from "@/db/schemas/seller";
import { sellerProfileChange } from "@/db/schemas/seller-profile-change";
import { ServiceError } from "@/lib/errors";
import { getEmployeeAssignedStoreIds } from "./access";

// ── Helpers ─────────────────────────────────

function assertActive(onboardingStatus: string) {
	if (onboardingStatus !== "active") {
		throw new ServiceError(
			400,
			"Settings can only be modified when onboarding is active",
		);
	}
}

function assertNoPendingChange(
	changes: { changeType: string; status: string }[],
	type: string,
) {
	const hasPending = changes.some(
		(c) => c.changeType === type && c.status === "pending",
	);
	if (hasPending) {
		throw new ServiceError(
			409,
			`A pending ${type} change request already exists`,
		);
	}
}

// ── GET settings ────────────────────────────

interface GetSellerSettingsParams {
	sellerProfileId: string;
	userId: string;
	isOwner: boolean;
}

export async function getSellerSettings(params: GetSellerSettingsParams) {
	const { sellerProfileId, userId, isOwner } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
		with: { changes: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");

	const [orgRaw, payment] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(organization.sellerProfileId, sellerProfileId),
			with: {
				municipality: {
					columns: { id: true, name: true },
					with: { province: { columns: { acronym: true } } },
				},
			},
		}),
		db.query.paymentMethod.findFirst({
			where: and(
				eq(paymentMethod.sellerProfileId, sellerProfileId),
				eq(paymentMethod.isDefault, true),
			),
		}),
	]);

	const pendingChanges = (profile.changes ?? []).filter(
		(c) => c.status === "pending",
	);

	const assignedStoreIds = isOwner
		? null
		: await getEmployeeAssignedStoreIds(userId, sellerProfileId);

	const org = orgRaw
		? (() => {
				const { municipality, ...rest } = orgRaw;
				return {
					...rest,
					municipality: {
						id: municipality.id,
						name: municipality.name,
						provinceAcronym: municipality.province.acronym,
					},
				};
			})()
		: null;

	return {
		profile,
		organization: org,
		paymentMethod: payment ?? null,
		pendingChanges,
		assignedStoreIds,
	};
}

// ── Livello 1: Modifica libera ──────────────

interface PersonalSettingsParams {
	sellerProfileId: string;
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

export async function updatePersonalSettings(params: PersonalSettingsParams) {
	const { sellerProfileId, userId, ...data } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertActive(profile.onboardingStatus);

	return db.transaction(async (tx) => {
		await tx
			.update(user)
			.set({
				firstName: data.firstName,
				lastName: data.lastName,
				birthDate: data.birthDate,
				name: `${data.firstName} ${data.lastName}`,
			})
			.where(eq(user.id, userId));

		const [updated] = await tx
			.update(sellerProfile)
			.set(data)
			.where(eq(sellerProfile.id, sellerProfileId))
			.returning();

		return updated;
	});
}

interface CompanySettingsParams {
	sellerProfileId: string;
	businessName: string;
	legalForm: string;
	addressLine1: string;
	country?: string;
	municipalityId: string;
	zipCode: string;
}

export async function updateCompanySettings(params: CompanySettingsParams) {
	const { sellerProfileId, ...data } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertActive(profile.onboardingStatus);

	const org = await db.query.organization.findFirst({
		where: eq(organization.sellerProfileId, sellerProfileId),
	});

	if (!org) throw new ServiceError(404, "Organization not found");

	const [updated] = await db
		.update(organization)
		.set({
			businessName: data.businessName,
			legalForm: data.legalForm,
			addressLine1: data.addressLine1,
			country: data.country ?? org.country,
			municipalityId: data.municipalityId,
			zipCode: data.zipCode,
		})
		.where(eq(organization.sellerProfileId, sellerProfileId))
		.returning();

	// Re-fetch with municipality join so the response includes the compact shape
	const result = await db.query.organization.findFirst({
		where: eq(organization.id, updated.id),
		with: {
			municipality: {
				columns: { id: true, name: true },
				with: { province: { columns: { acronym: true } } },
			},
		},
	});

	if (!result)
		throw new ServiceError(404, "Organization not found after update");

	const { municipality, ...rest } = result;
	return {
		...rest,
		municipality: {
			id: municipality.id,
			name: municipality.name,
			provinceAcronym: municipality.province.acronym,
		},
	};
}

// ── Livello 2: Change requests ──────────────

interface VatChangeParams {
	sellerProfileId: string;
	vatNumber: string;
}

export async function requestVatChange(params: VatChangeParams) {
	const { sellerProfileId, vatNumber } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
		with: { organization: true, changes: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertActive(profile.onboardingStatus);
	assertNoPendingChange(profile.changes ?? [], "vat");

	// Verify the new VAT is different from the current one
	if (profile.organization?.vatNumber === vatNumber) {
		throw new ServiceError(
			400,
			"The new VAT number is the same as the current one",
		);
	}

	return db.transaction(async (tx) => {
		const [change] = await tx
			.insert(sellerProfileChange)
			.values({
				sellerProfileId,
				changeType: "vat",
				changeData: { vatNumber },
			})
			.returning();

		// Block new orders while VAT change is pending
		await tx
			.update(sellerProfile)
			.set({ vatChangeBlocked: true })
			.where(eq(sellerProfile.id, sellerProfileId));

		return change;
	});
}

interface DocumentChangeParams {
	sellerProfileId: string;
	documentNumber: string;
	documentExpiry: string;
	documentIssuedMunicipality: string;
	documentImage?: File;
}

export async function requestDocumentChange(params: DocumentChangeParams) {
	const { sellerProfileId, documentImage, ...data } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
		with: { changes: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertActive(profile.onboardingStatus);
	assertNoPendingChange(profile.changes ?? [], "document");

	// Upload new document image to S3 if provided
	let imageData = {};
	if (documentImage) {
		const { publicUrl, s3 } = await import("@/lib/s3");
		const key = `documents/${sellerProfileId}/${crypto.randomUUID()}`;
		await s3.write(key, documentImage);
		imageData = {
			documentImageKey: key,
			documentImageUrl: publicUrl(key),
		};
	}

	const [change] = await db
		.insert(sellerProfileChange)
		.values({
			sellerProfileId,
			changeType: "document",
			changeData: { ...data, ...imageData },
		})
		.returning();

	return change;
}

interface PaymentChangeParams {
	sellerProfileId: string;
	stripeAccountId: string;
}

export async function requestPaymentChange(params: PaymentChangeParams) {
	const { sellerProfileId, stripeAccountId } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
		with: { changes: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertActive(profile.onboardingStatus);
	assertNoPendingChange(profile.changes ?? [], "payment");

	const [change] = await db
		.insert(sellerProfileChange)
		.values({
			sellerProfileId,
			changeType: "payment",
			changeData: { stripeAccountId },
		})
		.returning();

	return change;
}
