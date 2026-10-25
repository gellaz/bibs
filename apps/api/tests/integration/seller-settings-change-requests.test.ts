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

mock.module("@/lib/s3", () => ({
	s3: { write: mock(async () => {}), delete: mock(async () => {}) },
	publicUrl: (key: string) => `https://cdn.test/${key}`,
}));

import { eq } from "drizzle-orm";
import { organization } from "@/db/schemas/organization";
import { sellerProfile } from "@/db/schemas/seller";
import { sellerProfileChange } from "@/db/schemas/seller-profile-change";
import {
	cancelSellerChange,
	requestDocumentChange,
	requestVatChange,
} from "@/modules/seller/services/settings";
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
});

async function sellerWithOrg(vatNumber: string) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	await createTestOrganization(db, seller.profile.id, { vatNumber });
	return seller;
}

describe("requestVatChange", () => {
	it("creates a pending request and blocks new orders", async () => {
		const seller = await sellerWithOrg("IT00000000001");

		const change = await requestVatChange({
			sellerProfileId: seller.profile.id,
			vatNumber: "IT00000000002",
		});

		expect(change.status).toBe("pending");
		const [profile] = await getTestDb()
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, seller.profile.id));
		expect(profile.vatChangeBlocked).toBe(true);
	});

	it("rejects a VAT number already registered by another seller with 409", async () => {
		await sellerWithOrg("IT00000000009");
		const seller = await sellerWithOrg("IT00000000001");

		await expect(
			requestVatChange({
				sellerProfileId: seller.profile.id,
				vatNumber: "IT00000000009",
			}),
		).rejects.toMatchObject({ status: 409 });

		const changes = await getTestDb().select().from(sellerProfileChange);
		expect(changes).toEqual([]);
	});

	it("rejects a second pending VAT request with 409", async () => {
		const seller = await sellerWithOrg("IT00000000001");
		await requestVatChange({
			sellerProfileId: seller.profile.id,
			vatNumber: "IT00000000002",
		});

		await expect(
			requestVatChange({
				sellerProfileId: seller.profile.id,
				vatNumber: "IT00000000003",
			}),
		).rejects.toMatchObject({ status: 409 });
	});
});

describe("requestDocumentChange", () => {
	it("salva il tipo e il numero normalizzato", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const municipality = await createTestMunicipality(db);

		const change = await requestDocumentChange({
			sellerProfileId: seller.profile.id,
			documentType: "identity_card",
			documentNumber: "ca 12345 ab",
			documentExpiry: "2099-12-31",
			documentIssuedMunicipalityId: municipality.id,
		});

		expect(change.changeData).toMatchObject({
			documentType: "identity_card",
			documentNumber: "CA12345AB",
		});
	});

	it("rifiuta con 422 un documento scaduto e non salva la richiesta", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const municipality = await createTestMunicipality(db);

		await expect(
			requestDocumentChange({
				sellerProfileId: seller.profile.id,
				documentType: "identity_card",
				documentNumber: "CA12345AB",
				documentExpiry: "2020-01-01",
				documentIssuedMunicipalityId: municipality.id,
			}),
		).rejects.toMatchObject({ status: 422 });

		expect(await db.select().from(sellerProfileChange)).toEqual([]);
	});
});

describe("cancelSellerChange", () => {
	async function pendingVat(vatNumber = "IT00000000002") {
		const seller = await sellerWithOrg("IT00000000001");
		const change = await requestVatChange({
			sellerProfileId: seller.profile.id,
			vatNumber,
		});
		return { seller, change };
	}

	it("annulla una richiesta di partita IVA e toglie il blocco", async () => {
		const { seller, change } = await pendingVat();

		const cancelled = await cancelSellerChange({
			sellerProfileId: seller.profile.id,
			changeId: change.id,
		});

		expect(cancelled.status).toBe("cancelled");
		const db = getTestDb();
		const [profile] = await db
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, seller.profile.id));
		expect(profile.vatChangeBlocked).toBe(false);
		const [org] = await db
			.select()
			.from(organization)
			.where(eq(organization.sellerProfileId, seller.profile.id));
		expect(org.vatNumber).toBe("IT00000000001");
	});

	it("dopo l'annullamento accetta una nuova richiesta", async () => {
		const { seller, change } = await pendingVat();
		await cancelSellerChange({
			sellerProfileId: seller.profile.id,
			changeId: change.id,
		});

		const next = await requestVatChange({
			sellerProfileId: seller.profile.id,
			vatNumber: "IT00000000003",
		});

		expect(next.status).toBe("pending");
	});

	it("non annulla una richiesta già approvata", async () => {
		const { seller, change } = await pendingVat();
		await getTestDb()
			.update(sellerProfileChange)
			.set({ status: "approved" })
			.where(eq(sellerProfileChange.id, change.id));

		await expect(
			cancelSellerChange({
				sellerProfileId: seller.profile.id,
				changeId: change.id,
			}),
		).rejects.toMatchObject({ status: 400 });

		const [row] = await getTestDb()
			.select()
			.from(sellerProfileChange)
			.where(eq(sellerProfileChange.id, change.id));
		expect(row.status).toBe("approved");
	});

	it("non annulla la richiesta di un altro venditore", async () => {
		const { change } = await pendingVat();
		const other = await createTestSeller(getTestDb());

		await expect(
			cancelSellerChange({
				sellerProfileId: other.profile.id,
				changeId: change.id,
			}),
		).rejects.toMatchObject({ status: 400 });

		const [row] = await getTestDb()
			.select()
			.from(sellerProfileChange)
			.where(eq(sellerProfileChange.id, change.id));
		expect(row.status).toBe("pending");
	});
});
