import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { organization } from "@/db/schemas/organization";
import { sellerProfile } from "@/db/schemas/seller";
import { sellerProfileChange } from "@/db/schemas/seller-profile-change";
import {
	getDefaultPaymentMethod,
	toOnlinePayments,
} from "@/domain/billing/connect-account";
import { logger } from "@/infra/logger";
import { ServiceError } from "@/lib/errors";
import type { IdentityDocumentType } from "@/lib/schemas/forms/identity-document";
import { notifyAdminsNewRequest } from "@/modules/seller/services/admin-notifications";
import {
	municipalityCompactWith,
	toMunicipalityCompact,
} from "@/modules/seller/services/municipality";
import { getEmployeeAssignedStoreIds } from "./access";
import { checkDocument } from "./document-check";
import { fetchSellerProfileCompact } from "./profile";

// ── Helpers ─────────────────────────────────

function assertActive(onboardingStatus: string) {
	if (onboardingStatus !== "active") {
		throw new ServiceError(
			400,
			"Le impostazioni si possono modificare solo a onboarding completato",
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
			`Hai già una richiesta di cambio ${type === "vat" ? "partita IVA" : "documento"} in attesa`,
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

	if (!rawProfile) throw new ServiceError(404, "Profilo venditore non trovato");

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
				documentType: null,
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

	if (!profile) throw new ServiceError(404, "Profilo venditore non trovato");
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
	if (!updated) throw new ServiceError(404, "Profilo venditore non trovato");
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

	if (!profile) throw new ServiceError(404, "Profilo venditore non trovato");
	assertActive(profile.onboardingStatus);

	const org = await db.query.organization.findFirst({
		where: eq(organization.sellerProfileId, sellerProfileId),
	});

	if (!org) throw new ServiceError(404, "Azienda non trovata");

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
		throw new ServiceError(404, "Azienda non trovata dopo l'aggiornamento");

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

	if (!profile) throw new ServiceError(404, "Profilo venditore non trovato");
	assertActive(profile.onboardingStatus);
	await assertNoPendingChange(sellerProfileId, "vat");

	// Verify the new VAT is different from the current one
	if (profile.organization?.vatNumber === vatNumber) {
		throw new ServiceError(
			400,
			"La nuova partita IVA è uguale a quella attuale",
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

	const change = await db.transaction(async (tx) => {
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
	await notifyAdminsNewRequest({
		kind: "vat",
		sellerProfileId,
		changeId: change.id,
	});
	return change;
}

// Document photos are personal data: delete the ones nobody references any
// more. Best-effort, after the commit: a failed delete leaves an orphan file,
// never a half-applied decision. A decided request's changeData may point at a
// deleted key: the admin detail hides the photo once the request isn't pending.
export async function deleteDocumentImage(
	key: string,
	sellerProfileId: string,
	action: string,
) {
	const { s3 } = await import("@/infra/s3");
	await s3.delete(key).catch((err) => {
		logger.warn(
			{ sellerProfileId, key, action, err: String(err) },
			"Cleanup foto del documento fallito",
		);
	});
}

export async function cancelSellerChange(params: {
	sellerProfileId: string;
	changeId: string;
}) {
	const updated = await db.transaction(async (tx) => {
		// Compare-and-set come in approveChange/rejectChange: una decisione
		// dell'admin arrivata prima non si sovrascrive.
		const [updated] = await tx
			.update(sellerProfileChange)
			.set({ status: "cancelled" })
			.where(
				and(
					eq(sellerProfileChange.id, params.changeId),
					eq(sellerProfileChange.sellerProfileId, params.sellerProfileId),
					eq(sellerProfileChange.status, "pending"),
				),
			)
			.returning();

		if (!updated) {
			throw new ServiceError(
				400,
				"La richiesta di modifica non è più in attesa",
			);
		}

		if (updated.changeType === "vat") {
			await tx
				.update(sellerProfile)
				.set({ vatChangeBlocked: false })
				.where(eq(sellerProfile.id, params.sellerProfileId));
		}

		return updated;
	});

	// La foto caricata con la richiesta non serve più (come in rejectChange).
	const { documentImageKey } = updated.changeData as {
		documentImageKey?: unknown;
	};
	if (
		updated.changeType === "document" &&
		typeof documentImageKey === "string"
	) {
		await deleteDocumentImage(
			documentImageKey,
			params.sellerProfileId,
			"document_change_cancelled_cleanup_failed",
		);
	}
	return updated;
}

interface DocumentChangeParams {
	sellerProfileId: string;
	documentType: IdentityDocumentType;
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

	if (!profile) throw new ServiceError(404, "Profilo venditore non trovato");
	assertActive(profile.onboardingStatus);
	await assertNoPendingChange(sellerProfileId, "document");
	const documentNumber = checkDocument(data);

	// Upload new document image to S3 if provided
	const { publicUrl, s3 } = await import("@/infra/s3");
	const key = documentImage
		? `documents/${sellerProfileId}/${crypto.randomUUID()}`
		: null;
	if (documentImage && key) await s3.write(key, documentImage);
	const imageData = key
		? { documentImageKey: key, documentImageUrl: publicUrl(key) }
		: {};

	let change: typeof sellerProfileChange.$inferSelect;
	try {
		[change] = await db
			.insert(sellerProfileChange)
			.values({
				sellerProfileId,
				changeType: "document",
				changeData: { ...data, documentNumber, ...imageData },
			})
			.returning();
	} catch (err) {
		// Nessuna richiesta salvata (es. una concorrente ha preso il posto):
		// il file caricato resterebbe orfano (best-effort).
		if (key) await s3.delete(key).catch(() => {});
		throw err;
	}
	await notifyAdminsNewRequest({
		kind: "document",
		sellerProfileId,
		changeId: change.id,
	});
	return change;
}
