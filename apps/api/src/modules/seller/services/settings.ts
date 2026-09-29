import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { organization } from "@/db/schemas/organization";
import { sellerProfile } from "@/db/schemas/seller";
import { sellerProfileChange } from "@/db/schemas/seller-profile-change";
import { ServiceError } from "@/lib/errors";
import {
	municipalityCompactWith,
	toMunicipalityCompact,
} from "@/lib/municipality";
import {
	getDefaultPaymentMethod,
	toOnlinePayments,
} from "@/modules/billing/services/connect-account";
import { getEmployeeAssignedStoreIds } from "./access";
import { fetchSellerProfileCompact } from "./profile";

// ── Helpers ─────────────────────────────────

function assertActive(onboardingStatus: string) {
	if (onboardingStatus !== "active") {
		throw new ServiceError(
			400,
			"Settings can only be modified when onboarding is active",
		);
	}
}

/**
 * Una sola richiesta pending per tipo. Il check dà il messaggio giusto; la gara
 * tra due richieste concorrenti la chiude l'indice unico parziale (23505 → 409).
 */
async function assertNoPendingChange(
	sellerProfileId: string,
	type: "vat" | "document",
) {
	const pending = await db.query.sellerProfileChange.findFirst({
		columns: { id: true },
		where: and(
			eq(sellerProfileChange.sellerProfileId, sellerProfileId),
			eq(sellerProfileChange.changeType, type),
			eq(sellerProfileChange.status, "pending"),
		),
	});
	if (pending) {
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

	const rawProfile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
		with: {
			changes: true,
			residenceMunicipality: municipalityCompactWith,
			documentIssuedMunicipality: municipalityCompactWith,
		},
	});

	if (!rawProfile) throw new ServiceError(404, "Seller profile not found");

	const {
		residenceMunicipality: rawResidenceMunicipality,
		documentIssuedMunicipality: rawDocumentIssuedMunicipality,
		...profileRest
	} = rawProfile;
	const profile = {
		...profileRest,
		residenceMunicipality: rawResidenceMunicipality
			? toMunicipalityCompact(rawResidenceMunicipality)
			: null,
		documentIssuedMunicipality: rawDocumentIssuedMunicipality
			? toMunicipalityCompact(rawDocumentIssuedMunicipality)
			: null,
	};

	const [orgRaw, payment] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(organization.sellerProfileId, sellerProfileId),
			with: {
				municipality: municipalityCompactWith,
			},
		}),
		getDefaultPaymentMethod(sellerProfileId),
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
					municipality: toMunicipalityCompact(municipality),
				};
			})()
		: null;

	// Employees reach this endpoint (the profile page shows business info
	// read-only), but must never receive the owner's personal/identity-document
	// PII, the owner's online-payments status, or the owner's pending change requests.
	if (!isOwner) {
		return {
			profile: {
				...profile,
				changes: [],
				firstName: null,
				lastName: null,
				citizenship: null,
				birthCountry: null,
				birthDate: null,
				residenceCountry: null,
				residenceMunicipalityId: null,
				residenceMunicipality: null,
				residenceAddress: null,
				residenceZipCode: null,
				documentNumber: null,
				documentExpiry: null,
				documentIssuedMunicipalityId: null,
				documentIssuedMunicipality: null,
				documentImageUrl: null,
			},
			organization: org,
			onlinePayments: null,
			pendingChanges: [],
			assignedStoreIds,
		};
	}

	return {
		profile,
		organization: org,
		onlinePayments: toOnlinePayments(payment),
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
	residenceMunicipalityId: string;
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

	await db.transaction(async (tx) => {
		await tx
			.update(user)
			.set({
				firstName: data.firstName,
				lastName: data.lastName,
				birthDate: data.birthDate,
				name: `${data.firstName} ${data.lastName}`,
			})
			.where(eq(user.id, userId));

		await tx
			.update(sellerProfile)
			.set(data)
			.where(eq(sellerProfile.id, sellerProfileId));
	});

	const updated = await fetchSellerProfileCompact(
		eq(sellerProfile.id, sellerProfileId),
	);
	if (!updated) throw new ServiceError(404, "Seller profile not found");
	return updated;
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
			municipality: municipalityCompactWith,
		},
	});

	if (!result)
		throw new ServiceError(404, "Organization not found after update");

	const { municipality, ...rest } = result;
	return {
		...rest,
		municipality: toMunicipalityCompact(municipality),
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
		with: { organization: true },
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertActive(profile.onboardingStatus);
	await assertNoPendingChange(sellerProfileId, "vat");

	// Verify the new VAT is different from the current one
	if (profile.organization?.vatNumber === vatNumber) {
		throw new ServiceError(
			400,
			"The new VAT number is the same as the current one",
		);
	}

	// La P.IVA è unica tra le organizzazioni: meglio dirlo adesso che far
	// fallire l'approvazione dell'admin più avanti.
	const takenBy = await db.query.organization.findFirst({
		columns: { id: true },
		where: and(
			eq(organization.vatNumber, vatNumber),
			ne(organization.sellerProfileId, sellerProfileId),
		),
	});
	if (takenBy) {
		throw new ServiceError(
			409,
			"Questa partita IVA è già registrata da un altro venditore",
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
	documentIssuedMunicipalityId: string;
	documentImage?: File;
}

export async function requestDocumentChange(params: DocumentChangeParams) {
	const { sellerProfileId, documentImage, ...data } = params;

	const profile = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
	});

	if (!profile) throw new ServiceError(404, "Seller profile not found");
	assertActive(profile.onboardingStatus);
	await assertNoPendingChange(sellerProfileId, "document");

	// Upload new document image to S3 if provided
	const { publicUrl, s3 } = await import("@/lib/s3");
	const key = documentImage
		? `documents/${sellerProfileId}/${crypto.randomUUID()}`
		: null;
	if (documentImage && key) await s3.write(key, documentImage);
	const imageData = key
		? { documentImageKey: key, documentImageUrl: publicUrl(key) }
		: {};

	try {
		const [change] = await db
			.insert(sellerProfileChange)
			.values({
				sellerProfileId,
				changeType: "document",
				changeData: { ...data, ...imageData },
			})
			.returning();
		return change;
	} catch (err) {
		// Nessuna richiesta salvata (es. una concorrente ha preso il posto):
		// il file caricato resterebbe orfano (best-effort).
		if (key) await s3.delete(key).catch(() => {});
		throw err;
	}
}
