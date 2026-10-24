import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

const sendEmail = mock(
	async (_params: { to: string; subject: string; html: string }) => {},
);
mock.module("@/lib/email", () => ({ sendEmail }));

const write = mock(async () => {});
const remove = mock(async (_key: string) => {});
mock.module("@/lib/s3", () => ({
	s3: { write, delete: remove },
	publicUrl: (key: string) => `https://cdn.test/${key}`,
}));

import { eq } from "drizzle-orm";
import { sellerProfile } from "@/db/schemas/seller";
import {
	getOnboardingStatus,
	goBack,
	updateCompany,
	updateDocument,
	updatePersonalInfo,
} from "@/modules/seller/services/onboarding";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestMunicipality,
	createTestOrganization,
	createTestSeller,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	write.mockClear();
	remove.mockReset();
	remove.mockImplementation(async () => {});
	sendEmail.mockReset();
	sendEmail.mockImplementation(async () => {});
});

async function sellerAtDocumentStep() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	await db
		.update(sellerProfile)
		.set({ onboardingStatus: "pending_document" })
		.where(eq(sellerProfile.id, seller.profile.id));
	const municipality = await createTestMunicipality(db);
	return {
		userId: seller.user.id,
		profileId: seller.profile.id,
		municipalityId: municipality.id,
	};
}

const image = () =>
	new File([new Uint8Array([1, 2, 3])], "doc.jpg", { type: "image/jpeg" });

async function statusOf(userId: string) {
	const [row] = await getTestDb()
		.select()
		.from(sellerProfile)
		.where(eq(sellerProfile.userId, userId));
	return row.onboardingStatus;
}

describe("getOnboardingStatus", () => {
	it("include l'indirizzo del supporto da mostrare al venditore", async () => {
		const { userId } = await sellerAtDocumentStep();

		const status = await getOnboardingStatus(userId);

		expect(status.supportEmail).toBe("supporto@bibs.it");
	});
});

describe("updateDocument", () => {
	it("con l'organizzazione già salvata (rifiuto 'document') va dritto in revisione", async () => {
		const { userId, profileId, municipalityId } = await sellerAtDocumentStep();
		await createTestOrganization(getTestDb(), profileId);

		const profile = await updateDocument({
			userId,
			documentType: "passport",
			documentNumber: "YA1234567",
			documentExpiry: "2099-12-31",
			documentIssuedMunicipalityId: municipalityId,
			documentImage: image(),
		});

		expect(profile.onboardingStatus).toBe("pending_review");
		expect(sendEmail).toHaveBeenCalledTimes(1);
		expect(sendEmail.mock.calls[0][0].subject).toBe(
			"Abbiamo ricevuto la tua candidatura su bibs",
		);
	});

	it("ricaricando il documento cancella dallo storage la foto precedente", async () => {
		const { userId, profileId, municipalityId } = await sellerAtDocumentStep();
		await getTestDb()
			.update(sellerProfile)
			.set({ documentImageKey: `documents/${profileId}/vecchia` })
			.where(eq(sellerProfile.id, profileId));

		await updateDocument({
			userId,
			documentType: "passport",
			documentNumber: "YA1234567",
			documentExpiry: "2099-12-31",
			documentIssuedMunicipalityId: municipalityId,
			documentImage: image(),
		});

		expect(remove).toHaveBeenCalledTimes(1);
		expect(remove.mock.calls[0][0]).toBe(`documents/${profileId}/vecchia`);
	});

	it("se la cancellazione della foto precedente fallisce, il documento nuovo resta salvato", async () => {
		const { userId, profileId, municipalityId } = await sellerAtDocumentStep();
		await getTestDb()
			.update(sellerProfile)
			.set({ documentImageKey: `documents/${profileId}/vecchia` })
			.where(eq(sellerProfile.id, profileId));
		remove.mockImplementation(async () => {
			throw new Error("storage giù");
		});

		const profile = await updateDocument({
			userId,
			documentType: "passport",
			documentNumber: "YA1234567",
			documentExpiry: "2099-12-31",
			documentIssuedMunicipalityId: municipalityId,
			documentImage: image(),
		});

		expect(profile.onboardingStatus).toBe("pending_company");
	});

	it("salva tipo e numero normalizzato e passa a pending_company", async () => {
		const { userId, municipalityId } = await sellerAtDocumentStep();

		const profile = await updateDocument({
			userId,
			documentType: "passport",
			documentNumber: " ya 1234567 ",
			documentExpiry: "2099-12-31",
			documentIssuedMunicipalityId: municipalityId,
			documentImage: image(),
		});

		expect(profile.documentType).toBe("passport");
		expect(profile.documentNumber).toBe("YA1234567");
		expect(profile.onboardingStatus).toBe("pending_company");
		expect(write).toHaveBeenCalledTimes(1);
		expect(remove).not.toHaveBeenCalled();
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("dopo un rifiuto 'document', tornare all'anagrafica e riavanzare non perde i dati aziendali", async () => {
		const { userId, profileId, municipalityId } = await sellerAtDocumentStep();
		await createTestOrganization(getTestDb(), profileId);

		await goBack(userId);
		await updatePersonalInfo({
			userId,
			firstName: "Mario",
			lastName: "Rossi",
			citizenship: "IT",
			birthCountry: "IT",
			birthDate: "1990-01-01",
			residenceCountry: "IT",
			residenceMunicipalityId: municipalityId,
			residenceAddress: "Via Roma 1",
			residenceZipCode: "40100",
		});
		const profile = await updateDocument({
			userId,
			documentType: "passport",
			documentNumber: "YA1234567",
			documentExpiry: "2099-12-31",
			documentIssuedMunicipalityId: municipalityId,
			documentImage: image(),
		});

		expect(profile.onboardingStatus).toBe("pending_review");
	});

	it("rifiuta con 422 un numero che non è del tipo scelto, senza caricare la foto", async () => {
		const { userId, municipalityId } = await sellerAtDocumentStep();

		await expect(
			updateDocument({
				userId,
				documentType: "passport",
				documentNumber: "CA12345AB",
				documentExpiry: "2099-12-31",
				documentIssuedMunicipalityId: municipalityId,
				documentImage: image(),
			}),
		).rejects.toMatchObject({ status: 422 });

		expect(write).not.toHaveBeenCalled();
		expect(await statusOf(userId)).toBe("pending_document");
	});

	it("rifiuta con 422 un documento scaduto, senza caricare la foto", async () => {
		const { userId, municipalityId } = await sellerAtDocumentStep();

		await expect(
			updateDocument({
				userId,
				documentType: "identity_card",
				documentNumber: "CA12345AB",
				documentExpiry: "2020-01-01",
				documentIssuedMunicipalityId: municipalityId,
				documentImage: image(),
			}),
		).rejects.toMatchObject({ status: 422, message: "Il documento è scaduto" });

		expect(write).not.toHaveBeenCalled();
		expect(await statusOf(userId)).toBe("pending_document");
	});
});

describe("updateCompany", () => {
	it("porta in revisione e manda l'email di candidatura ricevuta", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "mario@test.com" });
		await db
			.update(sellerProfile)
			.set({ onboardingStatus: "pending_company" })
			.where(eq(sellerProfile.id, seller.profile.id));
		const municipality = await createTestMunicipality(db);

		const profile = await updateCompany({
			userId: seller.user.id,
			businessName: "Forno Bianchi",
			vatNumber: "12345678903",
			legalForm: "srl",
			addressLine1: "Via Roma 1",
			municipalityId: municipality.id,
			zipCode: "40100",
		});

		expect(profile.onboardingStatus).toBe("pending_review");
		expect(sendEmail).toHaveBeenCalledTimes(1);
		const [email] = sendEmail.mock.calls[0];
		expect(email.to).toBe("mario@test.com");
		expect(email.subject).toBe("Abbiamo ricevuto la tua candidatura su bibs");
	});
});
